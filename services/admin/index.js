import { handleAdminAction } from "./service.mjs";
import { loadRuntimeConfig } from "../../shared/config/env.mjs";
import { createDataTableRepository } from "../../shared/dynamo/repository.mjs";
import { getRuntimeDbFactory } from "../../shared/dynamo/runtimeDb.mjs";
import { badRequest, internalError } from "../../shared/ws/response.mjs";

export function createAdminHandler({ dbFactory } = {}) {
  return async function adminHandler(event) {
    const rc = event?.requestContext || {};
    console.info("ADMIN_EVENT:", {
      routeKey: rc.routeKey,
      connectionId: rc.connectionId,
      eventType: rc.eventType
    });

    try {
      const config = loadRuntimeConfig(process.env);

      let body = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        console.error("ADMIN_PARSE_ERROR:", { connectionId: rc.connectionId, body: event?.body });
        return badRequest("Invalid JSON body");
      }

      const action = body.action || rc.routeKey;
      if (!action) return badRequest("Missing action");

      console.info("ADMIN_ACTION:", { action, connectionId: rc.connectionId });

      const authToken = body?.auth?.token || "";
      const resolvedDbFactory = dbFactory || (await getRuntimeDbFactory());
      const repo = createDataTableRepository({ db: resolvedDbFactory, env: process.env });

      const result = await handleAdminAction({
        action,
        body,
        authToken,
        config,
        repo
      });

      console.info("ADMIN_RESULT:", { action, connectionId: rc.connectionId, statusCode: result?.statusCode });
      return result;
    } catch (err) {
      console.error("ADMIN_ERROR:", { connectionId: rc.connectionId, error: err?.message });
      return internalError(err?.message || "Internal Server Error");
    }
  };
}

export async function handler(event) {
  return createAdminHandler()(event);
}
