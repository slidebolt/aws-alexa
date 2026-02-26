import { RELAY_ACTIONS } from "../../shared/types/actions.mjs";
import {
  clientConnectionKey,
  clientDeviceKey,
  clientMetadataKey,
  connSessionKey
} from "../../shared/dynamo/keys.mjs";
import { isClientDeviceItem, toDeviceListItem } from "../../shared/types/entities.mjs";
import { ok, badRequest } from "../../shared/ws/response.mjs";
import { hashSecret } from "../../shared/crypto/secrets.mjs";

export async function handleRelayAction({ action, body = {}, requestContext = {}, repo }) {
  if (!RELAY_ACTIONS.includes(action)) {
    console.warn("RELAY_UNKNOWN_ACTION:", { action });
    return badRequest("Unsupported relay action", { action });
  }

  const normalizedAction = action === "delete_device" ? "device_delete" : action;

  switch (normalizedAction) {
    case "register":
      return handleRegister(body, requestContext, repo);
    case "state_update":
      return handleStateUpdate(body, repo);
    case "device_upsert":
      return handleDeviceUpsert(body, repo);
    case "list_devices":
      return handleListDevices(body, repo);
    case "device_delete":
      return handleDeviceDelete(body, repo);
    case "keepalive": {
      const ts = Date.now();
      console.info("KEEPALIVE:", { connectionId: requestContext.connectionId, ts });
      return ok({ type: "keepalive", ts });
    }
    default:
      return badRequest("Unsupported relay action", { action });
  }
}

async function handleRegister(body, requestContext, repo) {
  if (!body.clientId) return badRequest("Missing clientId");
  if (!body.secret) return badRequest("Missing secret");

  const connectionId = requestContext.connectionId ?? null;
  if (!connectionId) return badRequest("Missing connectionId");

  console.info("REGISTER_IN:", { clientId: body.clientId, connectionId });

  const metaRes = await repo.get(clientMetadataKey(body.clientId));
  const client = metaRes?.Item;
  if (!client || client.sk !== "METADATA") {
    console.warn("REGISTER_FAIL:", { reason: "invalid_client", clientId: body.clientId });
    return badRequest("Invalid client");
  }
  if (client.active === false) {
    console.warn("REGISTER_FAIL:", { reason: "client_inactive", clientId: body.clientId });
    return badRequest("Client inactive");
  }
  if (hashSecret(body.secret) !== client.secretHash) {
    console.warn("REGISTER_FAIL:", { reason: "invalid_secret", clientId: body.clientId });
    return badRequest("Invalid secret");
  }

  const now = new Date().toISOString();
  await repo.put({
    ...connSessionKey(connectionId),
    entityType: "session",
    clientId: body.clientId,
    connectedAt: now,
    updatedAt: now
  });
  await repo.put({
    ...clientConnectionKey(body.clientId),
    entityType: "connection",
    connectionId,
    updatedAt: now
  });

  console.info("REGISTER_OK:", { clientId: body.clientId, connectionId });
  return ok({
    action: "register",
    accepted: true,
    connectionId,
    clientId: body.clientId
  });
}

async function handleStateUpdate(body, repo) {
  if (!body.clientId) return badRequest("Missing clientId");
  if (!body.deviceId) return badRequest("Missing deviceId");
  if (!body.state || typeof body.state !== "object") return badRequest("Missing or invalid state");

  const now = new Date().toISOString();
  console.info("STATE_UPDATE_IN:", { clientId: body.clientId, deviceId: body.deviceId });
  await repo.update(
    clientDeviceKey(body.clientId, body.deviceId),
    "SET #state = :s, updatedAt = :u, #status = if_not_exists(#status, :active)",
    { "#state": "state", "#status": "status" },
    { ":s": body.state, ":u": now, ":active": "active" }
  );
  console.info("STATE_UPDATE_OK:", { clientId: body.clientId, deviceId: body.deviceId });
  return ok({ action: "state_update", accepted: true, deviceId: body.deviceId });
}

async function handleDeviceUpsert(body, repo) {
  if (!body.clientId) return badRequest("Missing clientId");
  if (!body.endpoint || typeof body.endpoint !== "object") return badRequest("Missing or invalid endpoint");
  if (!body.endpoint.endpointId) return badRequest("Missing endpoint.endpointId");

  const endpointId = body.endpoint.endpointId;
  const now = new Date().toISOString();
  console.info("DEVICE_UPSERT_IN:", { clientId: body.clientId, endpointId });

  const names = { "#endpoint": "endpoint", "#status": "status" };
  const values = {
    ":eid": endpointId,
    ":ep": body.endpoint,
    ":u": now,
    ":active": "active",
    ":cid": body.clientId
  };
  let updateExp = "SET endpointId = :eid, #endpoint = :ep, updatedAt = :u, #status = :active, clientId = :cid, firstSeen = if_not_exists(firstSeen, :u)";
  if (body.state) {
    names["#state"] = "state";
    values[":s"] = body.state;
    updateExp += ", #state = :s";
  }
  await repo.update(clientDeviceKey(body.clientId, endpointId), updateExp, names, values);
  console.info("DEVICE_UPSERT_OK:", { clientId: body.clientId, endpointId });
  return ok({ action: "device_upsert", accepted: true, deviceId: endpointId });
}

async function handleListDevices(body, repo) {
  if (!body.clientId) return badRequest("Missing clientId");
  console.info("LIST_DEVICES_IN:", { clientId: body.clientId });
  const res = await repo.query(
    "pk = :pk AND begins_with(sk, :sk)",
    { ":pk": `CLIENT#${body.clientId}`, ":sk": "DEVICE#" }
  );
  const devices = (res?.Items ?? [])
    .filter(isClientDeviceItem)
    .map(toDeviceListItem)
    .sort((a, b) => String(a.endpointId).localeCompare(String(b.endpointId)))
    .map(d => ({
      endpointId: d.endpointId,
      ...d.endpoint,
      state: d.state,
      status: d.status,
      updatedAt: d.updatedAt
    }));
  console.info("LIST_DEVICES_OUT:", { clientId: body.clientId, count: devices.length });
  return ok({ devices });
}

async function handleDeviceDelete(body, repo) {
  if (!body.clientId) return badRequest("Missing clientId");
  if (!body.deviceId) return badRequest("Missing deviceId");
  console.info("DEVICE_DELETE_IN:", { clientId: body.clientId, deviceId: body.deviceId });
  await repo.delete(clientDeviceKey(body.clientId, body.deviceId));
  console.info("DEVICE_DELETE_OK:", { clientId: body.clientId, deviceId: body.deviceId });
  return ok({ status: "deleted", deviceId: body.deviceId });
}
