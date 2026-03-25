import test from "node:test";
import assert from "node:assert/strict";
import { handleReporterEvent } from "../../services/reporter/service.mjs";

test("reporter builds and sends change report when device state changes", async () => {
  const sent = [];
  const res = await handleReporterEvent({
    repo: {
      get: async () => ({ Item: { pk: "CLIENT#c1", sk: "METADATA", ownerUserId: "u1" } })
    },
    tokenResolver: async (userId) => (userId === "u1" ? "token-1" : null),
    event: {
      Records: [
        {
          eventName: "MODIFY",
          oldImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", state: { powerState: "OFF" }, status: "active" },
          newImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", state: { powerState: "ON" }, status: "active" }
        },
        {
          eventName: "MODIFY",
          oldImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-2", state: { powerState: "ON" }, status: "active" },
          newImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-2", state: { powerState: "ON" }, status: "active" }
        }
      ]
    },
    reportSender: async (payload, normalized) => {
      sent.push([payload, normalized]);
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.processed, 2);
  assert.equal(res.changed, 1);
  assert.equal(res.sent, 1);
  assert.equal(sent[0][0].event.header.name, "ChangeReport");
  assert.equal(sent[0][1].deviceId, "lamp-1");
});

test("reporter emits delete report on soft delete or remove", async () => {
  const names = [];
  const res = await handleReporterEvent({
    repo: {
      get: async () => ({ Item: { pk: "CLIENT#c1", sk: "METADATA", ownerUserId: "u1" } })
    },
    tokenResolver: async () => "token-1",
    event: {
      Records: [
        {
          eventName: "MODIFY",
          oldImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", status: "active", state: { powerState: "ON" } },
          newImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", status: "deleted", state: { powerState: "ON" } }
        },
        {
          eventName: "REMOVE",
          oldImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-2", status: "deleted" }
        }
      ]
    },
    reportSender: async (payload) => {
      names.push(payload.event.header.name);
    }
  });
  assert.equal(res.changed, 2);
  assert.equal(res.sent, 2);
  assert.deepEqual(names.sort(), ["DeleteReport", "DeleteReport"]);
});

test("reporter emits AddOrUpdateReport when endpoint capabilities change", async () => {
  const sent = [];
  const oldEndpoint = {
    endpointId: "lamp-1",
    capabilities: [
      { interface: "Alexa.PowerController" },
      { interface: "Alexa.BrightnessController" },
      { interface: "Alexa.ColorController" }
    ]
  };
  const newEndpoint = {
    endpointId: "lamp-1",
    capabilities: [
      { interface: "Alexa.PowerController" },
      { interface: "Alexa.BrightnessController" },
      { interface: "Alexa.ColorTemperatureController" }
    ]
  };
  const res = await handleReporterEvent({
    repo: {
      get: async () => ({ Item: { pk: "CLIENT#c1", sk: "METADATA", ownerUserId: "u1" } })
    },
    tokenResolver: async () => "token-1",
    event: {
      Records: [
        {
          eventName: "MODIFY",
          oldImage: {
            pk: "CLIENT#c1", sk: "DEVICE#lamp-1", status: "active",
            state: { powerState: "ON" },
            endpoint: oldEndpoint
          },
          newImage: {
            pk: "CLIENT#c1", sk: "DEVICE#lamp-1", status: "active",
            state: { powerState: "ON" },
            endpoint: newEndpoint
          }
        }
      ]
    },
    reportSender: async (payload, normalized) => {
      sent.push(payload);
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.changed, 1);
  assert.equal(res.sent, 1);
  // Must be an AddOrUpdateReport, not a ChangeReport
  assert.equal(sent[0].event.header.namespace, "Alexa.Discovery");
  assert.equal(sent[0].event.header.name, "AddOrUpdateReport");
  // Payload should include the full updated endpoint
  const endpoints = sent[0].event.payload.endpoints;
  assert.ok(Array.isArray(endpoints), "payload.endpoints should be an array");
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].endpointId, "lamp-1");
  assert.deepEqual(endpoints[0].capabilities, newEndpoint.capabilities);
});

test("reporter emits ChangeReport (not AddOrUpdateReport) when only state changes", async () => {
  const sent = [];
  const endpoint = {
    endpointId: "lamp-1",
    capabilities: [
      { interface: "Alexa.PowerController" },
      { interface: "Alexa.BrightnessController" }
    ]
  };
  const res = await handleReporterEvent({
    repo: {
      get: async () => ({ Item: { pk: "CLIENT#c1", sk: "METADATA", ownerUserId: "u1" } })
    },
    tokenResolver: async () => "token-1",
    event: {
      Records: [
        {
          eventName: "MODIFY",
          oldImage: {
            pk: "CLIENT#c1", sk: "DEVICE#lamp-1", status: "active",
            state: { powerState: "OFF" },
            endpoint
          },
          newImage: {
            pk: "CLIENT#c1", sk: "DEVICE#lamp-1", status: "active",
            state: { powerState: "ON" },
            endpoint
          }
        }
      ]
    },
    reportSender: async (payload) => {
      sent.push(payload);
    }
  });
  assert.equal(res.sent, 1);
  // Same endpoint, different state — should be ChangeReport, not AddOrUpdateReport
  assert.equal(sent[0].event.header.name, "ChangeReport");
});
