import { loadRuntimeConfig } from "../../shared/config/env.mjs";
import { getRuntimeDbFactory } from "../../shared/dynamo/runtimeDb.mjs";
import { createDataTableRepository } from "../../shared/dynamo/repository.mjs";
import { handleReporterEvent } from "./service.mjs";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { userMetadataKey } from "../../shared/dynamo/keys.mjs";

async function sendToAlexaEventGateway(payload) {
  const token = payload?.event?.payload?.scope?.token || payload?.event?.endpoint?.scope?.token;
  const res = await fetch("https://api.amazonalexa.com/v3/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("REPORTER_SEND_FAIL:", { status: res.status, body });
  } else {
    console.info("REPORTER_SEND_OK:", { status: res.status });
  }
}

export function createReporterHandler({
  reportSender = sendToAlexaEventGateway,
  tokenResolver = null,
  dbFactory
} = {}) {
  return async function reporterHandler(event) {
    const recordCount = Array.isArray(event?.Records) ? event.Records.length : 0;
    console.info("REPORTER_TRIGGER:", { records: recordCount });

    try {
      loadRuntimeConfig(process.env);
      const resolvedDbFactory = dbFactory || (await getRuntimeDbFactory());
      const repo = createDataTableRepository({ db: resolvedDbFactory, env: process.env });

      // Default token resolver: look up alexaAccessToken, refreshing if expired
      const resolvedTokenResolver = tokenResolver || (async (userId) => {
        const metaRes = await repo.get(userMetadataKey(userId));
        const meta = metaRes?.Item;
        if (!meta) return null;

        const expiresAt = meta.alexaTokenExpiresAt ? new Date(meta.alexaTokenExpiresAt) : null;
        const expired = !expiresAt || expiresAt.getTime() - Date.now() < 60_000;

        if (!expired && meta.alexaAccessToken) return meta.alexaAccessToken;

        // Token missing or expiring within 60s — refresh it
        const refreshToken = meta.alexaRefreshToken;
        if (!refreshToken) {
          console.warn("REPORTER_NO_REFRESH_TOKEN:", { userId });
          return null;
        }

        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: process.env.ALEXA_CLIENT_ID,
          client_secret: process.env.ALEXA_CLIENT_SECRET
        });
        const tokenRes = await fetch("https://api.amazon.com/auth/o2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        if (!tokenRes.ok) {
          console.error("REPORTER_REFRESH_FAIL:", { status: tokenRes.status, userId });
          return null;
        }
        const tokens = await tokenRes.json();
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
        console.info("REPORTER_TOKEN_REFRESHED:", { userId });
        return tokens.access_token;
      });

      // DynamoDB stream records arrive with type descriptors in record.dynamodb.OldImage/NewImage.
      // Unmarshal them into plain objects so the service can work with record.oldImage/newImage.
      const unmarshaledEvent = {
        ...event,
        Records: (event?.Records || []).map(r => ({
          eventName: r.eventName,
          oldImage: r.dynamodb?.OldImage ? unmarshall(r.dynamodb.OldImage) : (r.oldImage || null),
          newImage: r.dynamodb?.NewImage ? unmarshall(r.dynamodb.NewImage) : (r.newImage || null)
        }))
      };
      const result = await handleReporterEvent({ event: unmarshaledEvent, repo, tokenResolver: resolvedTokenResolver, reportSender });
      console.info("REPORTER_DONE:", { records: recordCount, processed: result.processed, changed: result.changed, sent: result.sent });
      return result;
    } catch (err) {
      console.error("REPORTER_ERROR:", { error: err?.message });
      return {
        ok: false,
        error: err?.message || "Internal error"
      };
    }
  };
}

export async function handler(event) {
  return createReporterHandler()(event);
}
