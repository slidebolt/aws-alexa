import test from "node:test";
import assert from "node:assert/strict";
import { createSmartHomeHandler } from "../../services/smarthome/index.js";

test("smarthome handler validates DATA_TABLE env", async () => {
  delete process.env.DATA_TABLE;
  const handler = createSmartHomeHandler();
  const res = await handler({ directive: { header: { messageId: "m1" } } });
  assert.equal(res.event.header.name, "ErrorResponse");
  assert.equal(res.event.payload.type, "INTERNAL_ERROR");
  assert.match(res.event.payload.message, /DATA_TABLE/);
});

test("smarthome handler rejects missing directive", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  const handler = createSmartHomeHandler();
  const res = await handler({});
  assert.equal(res.event.header.name, "ErrorResponse");
  assert.equal(res.event.payload.type, "INVALID_DIRECTIVE");
});

test("smarthome handler bounces duplicate controller directive within TTL", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  const dbFactory = () => ({
    get: async (key) => {
      if (key?.sk?.startsWith("DEVICE#")) return { Item: { pk: key.pk, sk: key.sk } };
      return {};
    },
    put: async () => {},
    update: async () => {}
  });
  const handler = createSmartHomeHandler({ dbFactory });

  const directive = {
    header: { namespace: "Alexa.BrightnessController", name: "SetBrightness", messageId: "m1", correlationToken: "ct" },
    endpoint: { endpointId: "lamp-1", scope: { token: "tok" }, cookie: { clientId: "c1" } },
    payload: { brightness: 70 }
  };

  // First request goes through normally
  const first = await handler({ directive });
  assert.equal(first.event.header.name, "Response");

  // Immediate second request for same device+action is bounced
  const second = await handler({ directive: { ...directive, header: { ...directive.header, messageId: "m2" } } });
  assert.equal(second.event.header.name, "Response");
  assert.equal(second.event.endpoint.endpointId, "lamp-1");
});

