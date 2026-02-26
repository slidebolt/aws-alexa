import { ADMIN_ACTIONS } from "../../shared/types/actions.mjs";
import { clientMetadataKey } from "../../shared/dynamo/keys.mjs";
import { newClientId, newClientSecret, hashSecret } from "../../shared/crypto/secrets.mjs";
import { isClientMetadataItem, toClientListItem } from "../../shared/types/entities.mjs";
import { ok, badRequest, unauthorized } from "../../shared/ws/response.mjs";

export async function handleAdminAction({ action, body = {}, authToken = "", config = {}, repo }) {
  if (!config.adminSecret) {
    console.error("ADMIN_CONFIG_ERROR:", { reason: "admin_secret_not_configured" });
    return unauthorized("Admin secret not configured");
  }
  if (!authToken || authToken !== config.adminSecret) {
    console.warn("ADMIN_AUTH_FAIL:", { action });
    return unauthorized("Unauthorized");
  }
  if (!ADMIN_ACTIONS.includes(action)) {
    console.warn("ADMIN_UNKNOWN_ACTION:", { action });
    return badRequest("Unsupported admin action", { action });
  }

  console.info("ADMIN_DISPATCH:", { action, clientId: body.clientId || null });

  switch (action) {
    case "admin_list_clients":
      return handleListClients(repo);
    case "admin_create_client":
      if (!body.label) return badRequest("Missing label");
      return handleCreateClient(body, repo);
    case "admin_update_client":
      if (!body.clientId) return badRequest("Missing clientId");
      return handleUpdateClient(body, repo);
    case "admin_delete_client":
      if (!body.clientId) return badRequest("Missing clientId");
      return handleDeleteClient(body, repo);
    case "admin_revoke_client":
      if (!body.clientId) return badRequest("Missing clientId");
      return handleRevokeClient(body, repo);
    case "admin_add_user_to_client":
      if (!body.clientId) return badRequest("Missing clientId");
      if (!body.userId) return badRequest("Missing userId");
      return ok({ action, accepted: true });
    case "admin_remove_user_from_client":
      if (!body.userId) return badRequest("Missing userId");
      return ok({ action, accepted: true });
    case "admin_list_client_users":
      if (!body.clientId) return badRequest("Missing clientId");
      return ok({ action, items: [] });
    default:
      return badRequest("Unsupported admin action", { action });
  }
}

async function handleListClients(repo) {
  if (!repo || typeof repo.scan !== "function") {
    return ok({ action: "admin_list_clients", items: [], note: "repo not wired yet" });
  }
  const res = await repo.scan();
  const items = (res?.Items ?? [])
    .filter(isClientMetadataItem)
    .map(toClientListItem)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  console.info("ADMIN_LIST_CLIENTS:", { count: items.length });
  return ok({ action: "admin_list_clients", items });
}

async function handleCreateClient(body, repo) {
  if (!repo || typeof repo.put !== "function") {
    return ok({ action: "admin_create_client", note: "repo not wired yet" });
  }
  const now = new Date().toISOString();
  const clientId = newClientId();
  const secret = newClientSecret();
  const item = {
    ...clientMetadataKey(clientId),
    entityType: "client",
    label: body.label,
    active: true,
    secretHash: hashSecret(secret),
    createdAt: now,
    updatedAt: now
  };
  await repo.put(item);
  console.info("ADMIN_CREATE_CLIENT:", { clientId, label: item.label });
  return ok({
    action: "admin_create_client",
    clientId,
    secret,
    label: item.label,
    active: item.active,
    createdAt: item.createdAt
  });
}

async function handleUpdateClient(body, repo) {
  if (!repo || typeof repo.update !== "function") {
    return ok({ action: "admin_update_client", accepted: true, note: "repo not wired yet" });
  }
  const now = new Date().toISOString();
  const names = {};
  const values = { ":u": now };
  let updateExp = "SET updatedAt = :u";

  if (typeof body.label === "string" && body.label.length > 0) {
    names["#label"] = "label";
    values[":l"] = body.label;
    updateExp += ", #label = :l";
  }
  if (typeof body.active === "boolean") {
    names["#active"] = "active";
    values[":a"] = body.active;
    updateExp += ", #active = :a";
  }

  await repo.update(clientMetadataKey(body.clientId), updateExp, names, values);
  return ok({ action: "admin_update_client", accepted: true, clientId: body.clientId });
}

async function handleRevokeClient(body, repo) {
  if (!repo || typeof repo.update !== "function") {
    return ok({ action: "admin_revoke_client", accepted: true, note: "repo not wired yet" });
  }
  const now = new Date().toISOString();
  await repo.update(
    clientMetadataKey(body.clientId),
    "SET #active = :a, updatedAt = :u",
    { "#active": "active" },
    { ":a": false, ":u": now }
  );
  console.info("ADMIN_REVOKE_CLIENT:", { clientId: body.clientId });
  return ok({ action: "admin_revoke_client", accepted: true, clientId: body.clientId });
}

async function handleDeleteClient(body, repo) {
  if (!repo || typeof repo.delete !== "function") {
    return ok({ action: "admin_delete_client", accepted: true, note: "repo not wired yet" });
  }
  await repo.delete(clientMetadataKey(body.clientId));
  console.info("ADMIN_DELETE_CLIENT:", { clientId: body.clientId });
  return ok({ action: "admin_delete_client", accepted: true, clientId: body.clientId });
}
