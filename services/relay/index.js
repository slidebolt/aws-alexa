import { handleRelayAction } from "./service.mjs";
import { loadRuntimeConfig } from "../../shared/config/env.mjs";
import { createDataTableRepository } from "../../shared/dynamo/repository.mjs";
import { getRuntimeDbFactory } from "../../shared/dynamo/runtimeDb.mjs";
import { badRequest, internalError, unauthorized, tooManyRequests, wsJson } from "../../shared/ws/response.mjs";
import { connSessionKey, clientConnectionKey } from "../../shared/dynamo/keys.mjs";
import { checkRateLimit } from "../../shared/rateLimit/rateLimiter.mjs";

// Kick off DDB SDK dynamic import during Lambda init phase so it's ready before the first request
getRuntimeDbFactory();

export function createRelayHandler({ dbFactory } = {}) {
  return async function relayHandler(event) {
    const rc = event?.requestContext || {};
    console.info("WS_EVENT:", {
      routeKey: rc.routeKey,
      connectionId: rc.connectionId,
      eventType: rc.eventType,
      stage: rc.stage
    });

    try {
      loadRuntimeConfig(process.env);

      if (rc.routeKey === "$connect") {
        console.info("WS_CONNECT:", { connectionId: rc.connectionId });
        return wsJson(200, { connected: true });
      }

      if (rc.routeKey === "$disconnect") {
        console.info("WS_DISCONNECT:", { connectionId: rc.connectionId });
        const resolvedDbFactory = dbFactory || (await getRuntimeDbFactory());
        const repo = createDataTableRepository({ db: resolvedDbFactory, env: process.env });
        const sessionRes = await repo.get(connSessionKey(rc.connectionId));
        const clientId = sessionRes?.Item?.clientId;
        await repo.delete(connSessionKey(rc.connectionId));
        if (clientId) {
          await repo.delete(clientConnectionKey(clientId));
        }
        console.info("WS_DISCONNECT_OK:", { connectionId: rc.connectionId, clientId: clientId ?? null });
        return wsJson(200, { disconnected: true });
      }

      let body = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        console.error("WS_PARSE_ERROR:", { connectionId: rc.connectionId, body: event?.body });
        return badRequest("Invalid JSON body");
      }

      const action = body.action || rc.routeKey;
      if (!action) return badRequest("Missing action");

      console.info("WS_ACTION:", { action, connectionId: rc.connectionId });

      const resolvedDbFactory = dbFactory || (await getRuntimeDbFactory());
      const repo = createDataTableRepository({ db: resolvedDbFactory, env: process.env });

      if (action !== "register") {
        const sessionRes = await repo.get(connSessionKey(rc.connectionId));
        const session = sessionRes?.Item;
        if (!session) {
          console.warn("WS_AUTH_FAIL:", { reason: "no_session", connectionId: rc.connectionId, action });
          return unauthorized("Unauthorized");
        }
        if (body.clientId && body.clientId !== session.clientId) {
          console.warn("WS_AUTH_FAIL:", { reason: "clientId_mismatch", connectionId: rc.connectionId, action, bodyClientId: body.clientId, sessionClientId: session.clientId });
          return unauthorized("Unauthorized");
        }

        const normalizedAction = action === "delete_device" ? "device_delete" : action;
        const rl = await checkRateLimit({ clientId: session.clientId, action: normalizedAction, repo });
        if (!rl.allowed) {
          console.warn("WS_RATE_LIMITED:", { clientId: session.clientId, action, connectionId: rc.connectionId, hardLimit: rl.hardLimit });
          return tooManyRequests(`Rate limit exceeded for ${action}`);
        }
      }

      const result = await handleRelayAction({
        action,
        body,
        requestContext: rc,
        repo
      });

      console.info("WS_RESULT:", { action, connectionId: rc.connectionId, statusCode: result?.statusCode });
      return result;
    } catch (err) {
      console.error("WS_ERROR:", { connectionId: rc.connectionId, error: err?.message });
      return internalError(err?.message || "Internal Server Error");
    }
  };
}

export async function handler(event) {
  return createRelayHandler()(event);
}
