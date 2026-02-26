import test from "node:test";
import assert from "node:assert/strict";
import { createAdminHandler } from "../../services/admin/index.js";

function parse(res) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

test("admin handler rejects invalid JSON", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  process.env.ADMIN_SECRET = "topsecret";
  const handler = createAdminHandler();
  const out = parse(await handler({ body: "{bad", requestContext: { routeKey: "admin_list_clients" } }));
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Invalid JSON body");
});

test("admin handler returns internal error when DATA_TABLE missing", async () => {
  delete process.env.DATA_TABLE;
  process.env.ADMIN_SECRET = "topsecret";
  const handler = createAdminHandler();
  const out = parse(await handler({ body: JSON.stringify({ action: "admin_list_clients", auth: { token: "topsecret" } }) }));
  assert.equal(out.statusCode, 500);
  assert.match(out.body.error, /Missing required env var: DATA_TABLE/);
});

test("admin handler dispatches and uses injected db factory", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  process.env.ADMIN_SECRET = "topsecret";
  const handler = createAdminHandler({
    dbFactory: () => ({
      get: async () => ({}),
      put: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      scan: async () => ({ Items: [] }),
      query: async () => ({ Items: [] })
    })
  });
  const out = parse(await handler({
    body: JSON.stringify({ action: "admin_list_clients", auth: { token: "topsecret" } })
  }));
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "admin_list_clients");
});

