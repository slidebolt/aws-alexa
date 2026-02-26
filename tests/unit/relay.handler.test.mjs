import test from "node:test";
import assert from "node:assert/strict";
import { createRelayHandler } from "../../services/relay/index.js";

function parse(res) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

test("relay handler rejects invalid JSON", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  const handler = createRelayHandler();
  const out = parse(await handler({ body: "{oops", requestContext: { routeKey: "register" } }));
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Invalid JSON body");
});

test("relay handler requires action", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  const handler = createRelayHandler();
  const out = parse(await handler({ body: JSON.stringify({}) }));
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Missing action");
});

test("relay handler dispatches register with injected repo", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  const handler = createRelayHandler({
    dbFactory: () => ({
      get: async () => ({ Item: { pk: "CLIENT#c1", sk: "METADATA", secretHash: "e8bc163c82eee18733288c7d4ac636db3a6deb013ef2d37b68322be20edc45cc", active: true } }),
      put: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      scan: async () => ({ Items: [] }),
      query: async () => ({ Items: [] })
    })
  });
  const out = parse(await handler({
    body: JSON.stringify({ action: "register", clientId: "c1", secret: "s1" }),
    requestContext: { connectionId: "conn-1", routeKey: "register" }
  }));
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.action, "register");
  assert.equal(out.body.connectionId, "conn-1");
});

