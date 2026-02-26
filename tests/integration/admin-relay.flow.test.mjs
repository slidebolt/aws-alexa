import test from "node:test";
import assert from "node:assert/strict";
import { createAdminHandler } from "../../services/admin/index.js";
import { createRelayHandler } from "../../services/relay/index.js";
import { createSmartHomeHandler } from "../../services/smarthome/index.js";
import { createInMemoryDbFactory } from "../support/inMemoryDb.mjs";

function parseWs(res) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

test("admin + relay single-table flow", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  process.env.ADMIN_SECRET = "integration-admin-secret";

  const dbFactory = createInMemoryDbFactory();
  const adminHandler = createAdminHandler({ dbFactory });
  const relayHandler = createRelayHandler({ dbFactory });
  const smarthomeHandler = createSmartHomeHandler({ dbFactory });

  const createRes = parseWs(await adminHandler({
    body: JSON.stringify({
      action: "admin_create_client",
      auth: { token: process.env.ADMIN_SECRET },
      label: "Integration House"
    }),
    requestContext: { routeKey: "admin_create_client" }
  }));
  assert.equal(createRes.statusCode, 200);
  assert.equal(createRes.body.action, "admin_create_client");
  assert.ok(createRes.body.clientId);
  assert.ok(createRes.body.secret);

  const clientId = createRes.body.clientId;
  const clientSecret = createRes.body.secret;

  const listRes = parseWs(await adminHandler({
    body: JSON.stringify({
      action: "admin_list_clients",
      auth: { token: process.env.ADMIN_SECRET }
    }),
    requestContext: { routeKey: "admin_list_clients" }
  }));
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.items.length, 1);
  assert.equal(listRes.body.items[0].clientId, clientId);

  const badRegister = parseWs(await relayHandler({
    body: JSON.stringify({
      action: "register",
      clientId,
      secret: "wrong"
    }),
    requestContext: { routeKey: "register", connectionId: "conn-1" }
  }));
  assert.equal(badRegister.statusCode, 400);
  assert.equal(badRegister.body.error, "Invalid secret");

  const registerRes = parseWs(await relayHandler({
    body: JSON.stringify({
      action: "register",
      clientId,
      secret: clientSecret
    }),
    requestContext: { routeKey: "register", connectionId: "conn-1" }
  }));
  assert.equal(registerRes.statusCode, 200);
  assert.equal(registerRes.body.accepted, true);

  const upsertRes = parseWs(await relayHandler({
    body: JSON.stringify({
      action: "device_upsert",
      clientId,
      endpoint: { endpointId: "lamp-1", friendlyName: "Lamp 1" }
    }),
    requestContext: { routeKey: "device_upsert", connectionId: "conn-1" }
  }));
  assert.equal(upsertRes.statusCode, 200);
  assert.equal(upsertRes.body.deviceId, "lamp-1");

  const stateRes = parseWs(await relayHandler({
    body: JSON.stringify({
      action: "state_update",
      clientId,
      deviceId: "lamp-1",
      state: { powerState: "ON" }
    }),
    requestContext: { routeKey: "state_update", connectionId: "conn-1" }
  }));
  assert.equal(stateRes.statusCode, 200);

  const listDevicesRes = parseWs(await relayHandler({
    body: JSON.stringify({
      action: "list_devices",
      clientId
    }),
    requestContext: { routeKey: "list_devices", connectionId: "conn-1" }
  }));
  assert.equal(listDevicesRes.statusCode, 200);
  assert.equal(listDevicesRes.body.items.length, 1);
  assert.equal(listDevicesRes.body.items[0].deviceId, "lamp-1");
  assert.deepEqual(listDevicesRes.body.items[0].state, { powerState: "ON" });

  const discoveryRes = await smarthomeHandler({
    directive: {
      header: {
        namespace: "Alexa.Discovery",
        name: "Discover",
        payloadVersion: "3",
        messageId: "disc-1"
      },
      payload: { scope: { clientId } }
    }
  });
  assert.equal(discoveryRes.event.header.name, "Discover.Response");
  assert.equal(discoveryRes.event.payload.endpoints.length, 1);
  assert.equal(discoveryRes.event.payload.endpoints[0].endpointId, "lamp-1");

  const reportStateRes = await smarthomeHandler({
    directive: {
      header: {
        namespace: "Alexa",
        name: "ReportState",
        payloadVersion: "3",
        messageId: "rs-1",
        correlationToken: "ct-1"
      },
      endpoint: {
        endpointId: "lamp-1",
        cookie: { clientId }
      }
    }
  });
  assert.equal(reportStateRes.event.header.name, "StateReport");
  assert.equal(reportStateRes.context.properties[0].value, "ON");

  const deleteRes = parseWs(await relayHandler({
    body: JSON.stringify({
      action: "device_delete",
      clientId,
      deviceId: "lamp-1"
    }),
    requestContext: { routeKey: "device_delete", connectionId: "conn-1" }
  }));
  assert.equal(deleteRes.statusCode, 200);

  const listAfterDelete = parseWs(await relayHandler({
    body: JSON.stringify({
      action: "list_devices",
      clientId
    }),
    requestContext: { routeKey: "list_devices", connectionId: "conn-1" }
  }));
  assert.equal(listAfterDelete.statusCode, 200);
  assert.equal(listAfterDelete.body.items.length, 0);
});
