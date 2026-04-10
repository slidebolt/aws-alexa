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

test("smarthome AcceptGrant exchanges code using HTTP Basic client credentials", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  process.env.ALEXA_CLIENT_ID = "client-123";
  process.env.ALEXA_CLIENT_SECRET = "secret-456";
  process.env.ALEXA_REDIRECT_URI = "https://layla.amazon.com/api/skill/link/test-skill";

  const originalFetch = global.fetch;
  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === "https://api.amazon.com/user/profile") {
      return {
        ok: true,
        json: async () => ({ user_id: "amzn1.account.test", email: "tammy@357graphics.com" })
      };
    }
    if (url === "https://api.amazon.com/auth/o2/token") {
      return {
        ok: true,
        json: async () => ({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 })
      };
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  };

  const updates = [];
  const dbFactory = () => ({
    update: async (...args) => {
      updates.push(args);
      return {};
    }
  });

  try {
    const handler = createSmartHomeHandler({ dbFactory });
    const res = await handler({
      directive: {
        header: { namespace: "Alexa.Authorization", name: "AcceptGrant", messageId: "m3" },
        payload: {
          grantee: { token: "grantee-token" },
          grant: { code: "grant-code-123" }
        }
      }
    });

    assert.equal(res.event.header.name, "AcceptGrant.Response");
    assert.equal(fetchCalls.length, 2);

    const tokenCall = fetchCalls[1];
    assert.equal(tokenCall.url, "https://api.amazon.com/auth/o2/token");
    assert.equal(tokenCall.options.method, "POST");
    assert.equal(tokenCall.options.headers["Content-Type"], "application/x-www-form-urlencoded;charset=UTF-8");
    assert.equal(
      tokenCall.options.headers.Authorization,
      `Basic ${Buffer.from("client-123:secret-456", "utf8").toString("base64")}`
    );

    const params = new URLSearchParams(tokenCall.options.body);
    assert.equal(params.get("grant_type"), "authorization_code");
    assert.equal(params.get("code"), "grant-code-123");
    assert.equal(params.get("redirect_uri"), "https://layla.amazon.com/api/skill/link/test-skill");
    assert.equal(params.get("client_id"), null);
    assert.equal(params.get("client_secret"), null);

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0][0], { pk: "USER#amzn1.account.test", sk: "METADATA" });
  } finally {
    global.fetch = originalFetch;
  }
});
