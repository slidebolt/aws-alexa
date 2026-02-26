import test from "node:test";
import assert from "node:assert/strict";
import { handleSmartHomeDirective } from "../../services/smarthome/service.mjs";

test("smarthome returns discovery response", async () => {
  const repo = { query: async () => ({ Items: [] }) };
  const res = await handleSmartHomeDirective({
    repo,
    clientId: "c1",
    directive: {
      header: {
        namespace: "Alexa.Discovery",
        name: "Discover",
        payloadVersion: "3",
        messageId: "m1"
      },
      payload: { scope: { token: "tok" } }
    }
  });
  assert.equal(res.event.header.namespace, "Alexa.Discovery");
  assert.equal(res.event.header.name, "Discover.Response");
  assert.deepEqual(res.event.payload.endpoints, []);
});

test("smarthome discovery loads endpoints from client device rows", async () => {
  const repo = {
    query: async () => ({
      Items: [
        { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", endpoint: { endpointId: "lamp-1" } },
        { pk: "CLIENT#c1", sk: "METADATA" },
        { pk: "CLIENT#c1", sk: "DEVICE#lamp-2", endpoint: { endpointId: "lamp-2" } }
      ]
    })
  };
  const res = await handleSmartHomeDirective({
    repo,
    clientId: "c1",
    directive: {
      header: {
        namespace: "Alexa.Discovery",
        name: "Discover",
        payloadVersion: "3",
        messageId: "m1"
      },
      payload: { scope: { token: "tok" } }
    }
  });
  assert.equal(res.event.payload.endpoints.length, 2);
  assert.equal(res.event.payload.endpoints[0].endpointId, "lamp-1");
  assert.equal(res.event.payload.endpoints[1].endpointId, "lamp-2");
});

test("smarthome returns invalid directive error for unsupported namespace", async () => {
  const res = await handleSmartHomeDirective({
    clientId: "c1",
    directive: {
      header: { namespace: "Alexa.Foo", name: "Bar", messageId: "m2" }
    }
  });
  assert.equal(res.event.header.name, "ErrorResponse");
  assert.equal(res.event.payload.type, "INVALID_DIRECTIVE");
});

test("smarthome report state returns NO_SUCH_ENDPOINT when missing", async () => {
  const repo = { get: async () => ({}) };
  const res = await handleSmartHomeDirective({
    repo,
    clientId: "c1",
    directive: {
      header: { namespace: "Alexa", name: "ReportState", messageId: "m3", correlationToken: "ct" },
      endpoint: { endpointId: "lamp-1" }
    }
  });
  assert.equal(res.event.header.name, "ErrorResponse");
  assert.equal(res.event.payload.type, "NO_SUCH_ENDPOINT");
});

test("smarthome report state returns context properties from device row", async () => {
  const repo = {
    get: async () => ({
      Item: {
        pk: "CLIENT#c1",
        sk: "DEVICE#lamp-1",
        state: {
          properties: [
            {
              namespace: "Alexa.PowerController",
              name: "powerState",
              value: "ON",
              timeOfSample: "2026-02-24T00:00:00.000Z",
              uncertaintyInMilliseconds: 0
            }
          ]
        }
      }
    })
  };
  const res = await handleSmartHomeDirective({
    repo,
    clientId: "c1",
    directive: {
      header: { namespace: "Alexa", name: "ReportState", messageId: "m4", correlationToken: "ct" },
      endpoint: { endpointId: "lamp-1" }
    }
  });
  assert.equal(res.event.header.name, "StateReport");
  assert.equal(res.context.properties[0].value, "ON");
});

test("smarthome power control returns optimistic response", async () => {
  // WS_MGMT_ENDPOINT not set in test env → postDirectiveToClient skips silently
  const repo = { get: async () => ({ Item: { pk: "CLIENT#c1", sk: "DEVICE#lamp-1" } }) };
  const res = await handleSmartHomeDirective({
    repo,
    clientId: "c1",
    directive: {
      header: {
        namespace: "Alexa.PowerController",
        name: "TurnOn",
        messageId: "m5",
        correlationToken: "ct"
      },
      endpoint: { endpointId: "lamp-1" }
    }
  });
  assert.equal(res.event.header.name, "Response");
  assert.equal(res.context.properties[0].value, "ON");
  assert.equal(res.context.properties[0].namespace, "Alexa.PowerController");
});

test("smarthome power control returns NO_SUCH_ENDPOINT for deleted device", async () => {
  const repo = { get: async () => ({}) };
  const res = await handleSmartHomeDirective({
    repo,
    clientId: "c1",
    directive: {
      header: { namespace: "Alexa.PowerController", name: "TurnOn", messageId: "m6", correlationToken: "ct" },
      endpoint: { endpointId: "lamp-deleted" }
    }
  });
  assert.equal(res.event.header.name, "ErrorResponse");
  assert.equal(res.event.payload.type, "NO_SUCH_ENDPOINT");
});
