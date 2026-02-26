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
