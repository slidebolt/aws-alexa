import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminAction } from "../../services/admin/service.mjs";

function parse(res) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

test("admin requires configured secret", async () => {
  const out = parse(await handleAdminAction({ action: "admin_list_clients", config: {} }));
  assert.equal(out.statusCode, 403);
  assert.equal(out.body.error, "Admin secret not configured");
});

test("admin rejects invalid auth token", async () => {
  const out = parse(
    await handleAdminAction({
      action: "admin_list_clients",
      config: { adminSecret: "good" },
      authToken: "bad"
    })
  );
  assert.equal(out.statusCode, 403);
  assert.equal(out.body.error, "Unauthorized");
});

test("admin list clients succeeds with valid auth", async () => {
  const repo = {
    scan: async () => ({
      Items: [
        { pk: "CLIENT#c1", sk: "METADATA", label: "Home 1", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
        { pk: "USER#u1", sk: "METADATA", createdAt: "2026-01-01T00:00:00.000Z" },
        { pk: "CLIENT#c2", sk: "DEVICE#lamp-1", createdAt: "2026-01-01T00:00:01.000Z" }
      ]
    })
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_list_clients",
      config: { adminSecret: "good" },
      authToken: "good",
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "admin_list_clients");
  assert.equal(out.body.items.length, 1);
  assert.deepEqual(out.body.items[0], {
    clientId: "c1",
    label: "Home 1",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: null
  });
});

test("admin create client validates label", async () => {
  const bad = parse(
    await handleAdminAction({
      action: "admin_create_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: {}
    })
  );
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, "Missing label");
});

test("admin create client writes metadata item and returns credentials", async () => {
  const calls = [];
  const repo = {
    put: async (item) => {
      calls.push(item);
      return {};
    }
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_create_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { label: "Kitchen" },
      repo
    })
  );

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "admin_create_client");
  assert.equal(out.body.label, "Kitchen");
  assert.equal(typeof out.body.clientId, "string");
  assert.equal(typeof out.body.secret, "string");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pk, `CLIENT#${out.body.clientId}`);
  assert.equal(calls[0].sk, "METADATA");
  assert.equal(calls[0].entityType, "client");
  assert.equal(calls[0].label, "Kitchen");
  assert.equal(calls[0].active, true);
  assert.equal(typeof calls[0].secretHash, "string");
  assert.equal(calls[0].secretHash.length, 64); // sha256 hex
  assert.ok(!calls[0].secret); // plaintext secret must not be stored
});

test("admin update client issues repository update", async () => {
  const calls = [];
  const repo = {
    update: async (...args) => {
      calls.push(args);
      return {};
    }
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_update_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { clientId: "c1", label: "Renamed", active: false },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.clientId, "c1");
  assert.deepEqual(calls[0][0], { pk: "CLIENT#c1", sk: "METADATA" });
  assert.match(calls[0][1], /updatedAt/);
  assert.match(calls[0][1], /#label = :l/);
  assert.match(calls[0][1], /#active = :a/);
});

test("admin revoke client sets active=false", async () => {
  const calls = [];
  const repo = {
    update: async (...args) => {
      calls.push(args);
      return {};
    }
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_revoke_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { clientId: "c1" },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "admin_revoke_client");
  assert.deepEqual(calls[0][0], { pk: "CLIENT#c1", sk: "METADATA" });
  assert.deepEqual(calls[0][2], { "#active": "active" });
  assert.equal(calls[0][3][":a"], false);
});

test("admin add user to client writes user mapping", async () => {
  const calls = [];
  const repo = {
    put: async (item) => {
      calls.push(item);
      return {};
    }
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_add_user_to_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { clientId: "c1", userId: "amzn1.account.ABC123", email: "test@example.com" },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "admin_add_user_to_client");
  assert.equal(out.body.accepted, true);
  assert.equal(out.body.userId, "amzn1.account.ABC123");
  assert.equal(out.body.clientId, "c1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pk, "USER#amzn1.account.ABC123");
  assert.equal(calls[0].sk, "METADATA");
  assert.equal(calls[0].email, "test@example.com");
  assert.equal(calls[0].clientId, "c1");
  assert.ok(calls[0].mappedAt);
});

test("admin add user to client validates required fields", async () => {
  const noClient = parse(
    await handleAdminAction({
      action: "admin_add_user_to_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { userId: "u1" }
    })
  );
  assert.equal(noClient.statusCode, 400);

  const noUser = parse(
    await handleAdminAction({
      action: "admin_add_user_to_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { clientId: "c1" }
    })
  );
  assert.equal(noUser.statusCode, 400);
});

test("admin remove user from client deletes user record", async () => {
  const calls = [];
  const repo = {
    delete: async (key) => {
      calls.push(key);
      return {};
    }
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_remove_user_from_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { userId: "amzn1.account.ABC123" },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "admin_remove_user_from_client");
  assert.equal(out.body.accepted, true);
  assert.deepEqual(calls[0], { pk: "USER#amzn1.account.ABC123", sk: "METADATA" });
});

test("admin list client users returns mapped users", async () => {
  const repo = {
    scan: async () => ({
      Items: [
        { pk: "USER#u1", sk: "METADATA", email: "a@test.com", clientId: "c1", mappedAt: "2026-01-01T00:00:00.000Z" },
        { pk: "USER#u2", sk: "METADATA", email: "b@test.com", clientId: "c2", mappedAt: "2026-01-02T00:00:00.000Z" },
        { pk: "USER#u3", sk: "METADATA", email: "c@test.com", clientId: "c1", mappedAt: "2026-01-03T00:00:00.000Z" },
        { pk: "CLIENT#c1", sk: "METADATA", label: "Home" }
      ]
    })
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_list_client_users",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { clientId: "c1" },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.items.length, 2);
  assert.equal(out.body.items[0].email, "a@test.com");
  assert.equal(out.body.items[1].email, "c@test.com");
});

test("admin delete client issues repository delete", async () => {
  const calls = [];
  const repo = {
    delete: async (key) => {
      calls.push(key);
      return {};
    }
  };
  const out = parse(
    await handleAdminAction({
      action: "admin_delete_client",
      config: { adminSecret: "good" },
      authToken: "good",
      body: { clientId: "c1" },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "admin_delete_client");
  assert.deepEqual(calls[0], { pk: "CLIENT#c1", sk: "METADATA" });
});
