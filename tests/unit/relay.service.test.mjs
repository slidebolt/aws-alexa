import test from "node:test";
import assert from "node:assert/strict";
import { handleRelayAction } from "../../services/relay/service.mjs";

function parse(res) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

test("relay rejects unsupported action", async () => {
  const out = parse(await handleRelayAction({ action: "unknown" }));
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Unsupported relay action");
});

test("relay register validates clientId and secret", async () => {
  let out = parse(await handleRelayAction({ action: "register", body: {} }));
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Missing clientId");

  out = parse(await handleRelayAction({ action: "register", body: { clientId: "c1" } }));
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Missing secret");
});

test("relay register validates connection and client secret against repo", async () => {
  const repo = {
    get: async () => ({ Item: { pk: "CLIENT#c1", sk: "METADATA", active: true, secretHash: "770e607624d689265ca6c44884d0807d9b054d23c473c106c72be9de08b7376c" } }),
    put: async () => ({})
  };
  let out = parse(
    await handleRelayAction({
      action: "register",
      body: { clientId: "c1", secret: "good" },
      requestContext: {}
    })
  );
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Missing connectionId");

  out = parse(
    await handleRelayAction({
      action: "register",
      body: { clientId: "c1", secret: "good" },
      requestContext: { connectionId: "abc" },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.accepted, true);
  assert.equal(out.body.connectionId, "abc");
});

test("relay register rejects invalid secret", async () => {
  const repo = {
    get: async () => ({ Item: { pk: "CLIENT#c1", sk: "METADATA", active: true, secretHash: "770e607624d689265ca6c44884d0807d9b054d23c473c106c72be9de08b7376c" } }),
    put: async () => ({})
  };
  const out = parse(
    await handleRelayAction({
      action: "register",
      body: { clientId: "c1", secret: "bad" },
      requestContext: { connectionId: "abc" },
      repo
    })
  );
  assert.equal(out.statusCode, 400);
  assert.equal(out.body.error, "Invalid secret");
});

test("relay list_devices uses repo query and filters non-device items", async () => {
  const repo = {
    query: async () => ({
      Items: [
        { pk: "CLIENT#c1", sk: "METADATA" },
        { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", endpointId: "lamp-1", endpoint: { endpointId: "lamp-1", friendlyName: "Lamp One" }, status: "active", updatedAt: "2026-01-01T00:00:00Z" },
        { pk: "CLIENT#c1", sk: "DEVICE#lamp-2", endpointId: "lamp-2", endpoint: { endpointId: "lamp-2", friendlyName: "Lamp Two" }, state: { properties: [] }, status: "active", updatedAt: "2026-01-02T00:00:00Z" },
        { pk: "USER#u1", sk: "METADATA" }
      ]
    })
  };
  const out = parse(await handleRelayAction({ action: "list_devices", body: { clientId: "c1" }, repo }));
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.devices.length, 2);
  assert.equal(out.body.devices[0].endpointId, "lamp-1");
  assert.equal(out.body.devices[0].friendlyName, "Lamp One");
  assert.equal(out.body.devices[1].endpointId, "lamp-2");
  assert.equal(out.body.devices[1].friendlyName, "Lamp Two");
});

test("relay device_upsert writes device metadata item", async () => {
  const calls = [];
  const repo = {
    update: async (key, exp, names, values) => {
      calls.push({ key, exp, names, values });
      return {};
    }
  };
  const out = parse(
    await handleRelayAction({
      action: "device_upsert",
      body: {
        clientId: "c1",
        endpoint: { endpointId: "lamp-1", friendlyName: "Lamp" }
      },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.deviceId, "lamp-1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].key, { pk: "CLIENT#c1", sk: "DEVICE#lamp-1" });
  assert.equal(calls[0].values[":eid"], "lamp-1");
  assert.equal(calls[0].values[":active"], "active");
  assert.match(calls[0].exp, /firstSeen = if_not_exists/);
});

test("relay device_upsert stores state when provided", async () => {
  const calls = [];
  const repo = {
    update: async (key, exp, names, values) => {
      calls.push({ exp, names, values });
      return {};
    }
  };
  const state = { properties: [{ namespace: "Alexa.PowerController", name: "powerState", value: "ON" }] };
  await handleRelayAction({
    action: "device_upsert",
    body: { clientId: "c1", endpoint: { endpointId: "lamp-1" }, state },
    repo
  });
  assert.ok(calls[0].exp.includes("#state = :s"));
  assert.deepEqual(calls[0].values[":s"], state);
});

test("relay state_update issues repository update", async () => {
  const calls = [];
  const repo = {
    update: async (...args) => {
      calls.push(args);
      return {};
    }
  };
  const out = parse(
    await handleRelayAction({
      action: "state_update",
      body: {
        clientId: "c1",
        deviceId: "lamp-1",
        state: { powerState: "ON" }
      },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.deviceId, "lamp-1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], { pk: "CLIENT#c1", sk: "DEVICE#lamp-1" });
  assert.match(calls[0][1], /SET #state = :s/);
});

test("relay device_delete deletes device key", async () => {
  const calls = [];
  const repo = {
    delete: async (key) => {
      calls.push(key);
      return {};
    }
  };
  const out = parse(
    await handleRelayAction({
      action: "device_delete",
      body: { clientId: "c1", deviceId: "lamp-1" },
      repo
    })
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.status, "deleted");
  assert.equal(out.body.deviceId, "lamp-1");
  assert.deepEqual(calls[0], { pk: "CLIENT#c1", sk: "DEVICE#lamp-1" });
});
