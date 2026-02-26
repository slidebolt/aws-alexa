import test from "node:test";
import assert from "node:assert/strict";
import { createReporterHandler } from "../../services/reporter/index.js";
import { createInMemoryDbFactory } from "../support/inMemoryDb.mjs";

test("reporter handler validates DATA_TABLE env", async () => {
  delete process.env.DATA_TABLE;
  const handler = createReporterHandler();
  const res = await handler({ Records: [] });
  assert.equal(res.ok, false);
  assert.match(res.error, /DATA_TABLE/);
});

test("reporter handler unmarshals DynamoDB stream format", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  const sent = [];
  const dbFactory = createInMemoryDbFactory();
  await dbFactory("SldBltData-v1-prod").put({
    pk: "CLIENT#c1",
    sk: "METADATA",
    ownerUserId: "u1"
  });
  const handler = createReporterHandler({
    dbFactory,
    tokenResolver: async () => "token-1",
    reportSender: async (payload) => { sent.push(payload.event.header.name); }
  });
  // Real DynamoDB stream record format: type descriptors in record.dynamodb.OldImage/NewImage
  const res = await handler({
    Records: [
      {
        eventName: "REMOVE",
        dynamodb: {
          OldImage: {
            pk: { S: "CLIENT#c1" },
            sk: { S: "DEVICE#lamp-1" },
            status: { S: "active" }
          }
        }
      }
    ]
  });
  assert.equal(res.ok, true);
  assert.equal(res.changed, 1);
  assert.equal(res.sent, 1);
  assert.deepEqual(sent, ["DeleteReport"]);
});

test("reporter handler delegates to service", async () => {
  process.env.DATA_TABLE = "SldBltData-v1-prod";
  let calls = 0;
  const dbFactory = createInMemoryDbFactory();
  await dbFactory("SldBltData-v1-prod").put({
    pk: "CLIENT#c1",
    sk: "METADATA",
    ownerUserId: "u1"
  });
  const handler = createReporterHandler({
    dbFactory,
    tokenResolver: async () => "token-1",
    reportSender: async () => {
      calls += 1;
    }
  });
  const res = await handler({
    Records: [{
      eventName: "MODIFY",
      oldImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", state: { powerState: "OFF" }, status: "active" },
      newImage: { pk: "CLIENT#c1", sk: "DEVICE#lamp-1", state: { powerState: "ON" }, status: "active" }
    }]
  });
  assert.equal(res.ok, true);
  assert.equal(res.changed, 1);
  assert.equal(res.sent, 1);
  assert.equal(calls, 1);
});
