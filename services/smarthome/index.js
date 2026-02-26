import { loadRuntimeConfig } from "../../shared/config/env.mjs";
import { createDataTableRepository } from "../../shared/dynamo/repository.mjs";
import { getRuntimeDbFactory } from "../../shared/dynamo/runtimeDb.mjs";
import { alexaError, alexaResponse } from "../../shared/alexa/response.mjs";
import { userMetadataKey } from "../../shared/dynamo/keys.mjs";
import { handleSmartHomeDirective } from "./service.mjs";

// Kick off DDB SDK dynamic import during Lambda init phase so it's ready before the first request
getRuntimeDbFactory();

// In-memory dedup map: key = "endpointId:namespace:name" → timestamp of last forwarded directive
// Entries expire after DEDUP_TTL_MS — requests within the window for the same device+action are bounced
const recentCommands = new Map();
const DEDUP_TTL_MS = 500;

async function getUserProfile(token) {
  try {
    const res = await fetch("https://api.amazon.com/user/profile", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.warn("PROFILE_FAIL:", res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn("PROFILE_ERROR:", err?.message);
    return null;
  }
}

async function handleAcceptGrant(userId, directive, repo) {
  const code = directive?.payload?.grant?.code;
  const alexaClientId = process.env.ALEXA_CLIENT_ID;
  const alexaClientSecret = process.env.ALEXA_CLIENT_SECRET;
  const success = {
    event: {
      header: {
        namespace: "Alexa.Authorization",
        name: "AcceptGrant.Response",
        payloadVersion: "3",
        messageId: (directive?.header?.messageId || "grant") + "-rsp"
      },
      payload: {}
    }
  };

  if (!code || !alexaClientId || !alexaClientSecret) {
    console.error("ACCEPT_GRANT_FAIL: Missing code or credentials");
    return success;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: alexaClientId,
      client_secret: alexaClientSecret
    });
    const res = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!res.ok) {
      console.error("ACCEPT_GRANT_FAIL:", res.status, await res.text());
      return success;
    }
    const tokens = await res.json();
    await repo.update(
      userMetadataKey(userId),
      "SET alexaAccessToken = :at, alexaRefreshToken = :rt, alexaTokenExpiresAt = :exp",
      null,
      {
        ":at": tokens.access_token,
        ":rt": tokens.refresh_token,
        ":exp": new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      }
    );
    console.info("ACCEPT_GRANT_OK:", { userId });
  } catch (err) {
    console.error("ACCEPT_GRANT_ERROR:", err?.message);
  }
  return success;
}

export function createSmartHomeHandler({ dbFactory } = {}) {
  return async function smartHomeHandler(event) {
    const directive = event?.directive;
    const header = directive?.header || {};
    console.info("REQ_HEADER:", {
      namespace: header.namespace,
      name: header.name,
      messageId: header.messageId,
      correlationTokenPresent: !!header.correlationToken
    });

    try {
      loadRuntimeConfig(process.env);

      if (!directive) {
        return alexaError({ type: "INVALID_DIRECTIVE", message: "Missing directive", messageId: "missing" });
      }

      const ns = header.namespace;
      const name = header.name;
      const endpointId = directive?.endpoint?.endpointId;

      // Dedup check: bounce repeat controller directives for the same device within TTL window
      if (ns?.endsWith("Controller") && endpointId) {
        const dedupKey = `${endpointId}:${ns}:${name}`;
        const last = recentCommands.get(dedupKey);
        if (last && Date.now() - last < DEDUP_TTL_MS) {
          console.info("DEDUP_BOUNCE:", { endpointId, namespace: ns, name });
          return alexaResponse({
            namespace: "Alexa",
            name: "Response",
            messageId: header.messageId,
            correlationToken: header.correlationToken,
            endpoint: { endpointId },
            payload: {}
          });
        }
      }

      // Extract bearer token (location differs by directive type)
      let token;
      if (ns === "Alexa.Discovery") {
        token = directive?.payload?.scope?.token;
      } else if (ns === "Alexa.Authorization") {
        token = directive?.payload?.grantee?.token;
      } else {
        token = directive?.endpoint?.scope?.token;
      }

      if (!token) {
        return alexaError({ type: "INVALID_AUTHORIZATION_CREDENTIAL", message: "Missing token", messageId: header.messageId });
      }

      // Fast path: cookie.clientId set by discovery response — skip profile API and user lookup
      const cookieClientId = directive?.endpoint?.cookie?.clientId;
      if (cookieClientId && ns !== "Alexa.Discovery" && ns !== "Alexa.Authorization") {
        console.info("AUTH_COOKIE:", { clientId: cookieClientId });
        const resolvedDbFactory = dbFactory || (await getRuntimeDbFactory());
        const repo = createDataTableRepository({ db: resolvedDbFactory, env: process.env });
        const result = await handleSmartHomeDirective({ directive, repo, clientId: cookieClientId });
        if (ns?.endsWith("Controller") && endpointId) {
          recentCommands.set(`${endpointId}:${ns}:${name}`, Date.now());
        }
        return result;
      }

      // Full auth: token → Amazon profile API → user→client mapping
      let userId, userEmail;
      const TEST_ALEXA_TOKEN = process.env.TEST_ALEXA_TOKEN;
      if (TEST_ALEXA_TOKEN && token === TEST_ALEXA_TOKEN) {
        userId = "test-user-id";
        console.info("AUTH_TEST_BYPASS:", { userId });
      } else {
        const profile = await getUserProfile(token);
        if (!profile?.user_id) {
          return alexaError({ type: "INVALID_AUTHORIZATION_CREDENTIAL", message: "Invalid token", messageId: header.messageId });
        }
        userId = profile.user_id;
        userEmail = profile.email;
        console.info("AUTH_OK:", { userId, email: userEmail });
      }

      const resolvedDbFactory = dbFactory || (await getRuntimeDbFactory());
      const repo = createDataTableRepository({ db: resolvedDbFactory, env: process.env });

      // AcceptGrant doesn't need a client mapping
      if (ns === "Alexa.Authorization" && name === "AcceptGrant") {
        return await handleAcceptGrant(userId, directive, repo);
      }

      // Resolve user → client mapping
      let mappingRes = await repo.get(userMetadataKey(userId));
      let mapping = mappingRes?.Item;

      // Auto-claim: first time a user hits this skill, claim the client by email
      if (!mapping && userEmail) {
        console.info("AUTH_AUTOCLAIM:", { userId, email: userEmail });
        const emailRes = await repo.query("gsi1pk = :e", { ":e": `EMAIL#${userEmail}` }, "GSI1");
        const candidate = emailRes?.Items?.[0];
        if (candidate) {
          const targetClientId = candidate.clientId || candidate.pk?.replace("CLIENT#", "");
          if (!candidate.ownerUserId) {
            try {
              await repo.update(
                { pk: candidate.pk, sk: candidate.sk },
                "SET ownerUserId = :u, lastSeen = :now",
                null,
                { ":u": userId, ":now": new Date().toISOString() },
                "attribute_not_exists(ownerUserId)"
              );
              const newMapping = {
                pk: `USER#${userId}`,
                sk: "METADATA",
                clientId: targetClientId,
                email: userEmail,
                mappedAt: new Date().toISOString()
              };
              await repo.put(newMapping);
              mapping = newMapping;
              console.info("AUTH_CLAIM_OK:", { userId, clientId: targetClientId });
            } catch (err) {
              if (err.name === "ConditionalCheckFailedException") {
                return alexaError({ type: "ACCEPT_GRANT_FAILED", message: "House already claimed.", messageId: header.messageId });
              }
              throw err;
            }
          } else if (candidate.ownerUserId === userId) {
            const newMapping = {
              pk: `USER#${userId}`,
              sk: "METADATA",
              clientId: targetClientId,
              email: userEmail,
              mappedAt: new Date().toISOString()
            };
            await repo.put(newMapping);
            mapping = newMapping;
            console.info("AUTH_CLAIM_RECOVER:", { userId, clientId: targetClientId });
          }
        }
      }

      if (!mapping?.clientId) {
        console.warn("AUTH_UNMAPPED:", { userId });
        return alexaError({ type: "ACCEPT_GRANT_FAILED", message: "No house assigned to this account.", messageId: header.messageId });
      }

      const clientId = mapping.clientId;
      console.info("AUTH_CLIENT:", { userId, clientId });

      const result = await handleSmartHomeDirective({ directive, repo, clientId });
      if (ns?.endsWith("Controller") && endpointId) {
        recentCommands.set(`${endpointId}:${ns}:${name}`, Date.now());
      }
      return result;
    } catch (err) {
      console.error("REQ_ERROR:", { messageId: header.messageId, error: err?.message });
      return alexaError({ type: "INTERNAL_ERROR", message: err?.message || "Internal error", messageId: header.messageId });
    }
  };
}

export async function handler(event) {
  return createSmartHomeHandler()(event);
}
