import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, RATE_LIMITS, HARD_LIMIT_MULTIPLIER } from "../../shared/rateLimit/rateLimiter.mjs";
import { createInMemoryDbFactory } from "../support/inMemoryDb.mjs";
import { createDataTableRepository } from "../../shared/dynamo/repository.mjs";

function makeRepo() {
  process.env.DATA_TABLE = "test-table";
  const db = createInMemoryDbFactory();
  return createDataTableRepository({ db, env: process.env });
}

test("RATE_LIMITS exports expected actions", () => {
  assert.ok(typeof RATE_LIMITS.state_update === "number");
  assert.ok(typeof RATE_LIMITS.device_upsert === "number");
  assert.ok(typeof RATE_LIMITS.keepalive === "number");
  assert.ok(typeof RATE_LIMITS.default === "number");
  assert.equal(HARD_LIMIT_MULTIPLIER, 2);
});

test("checkRateLimit allows requests under hard limit", async () => {
  const repo = makeRepo();
  const hardLimit = RATE_LIMITS.keepalive * HARD_LIMIT_MULTIPLIER; // 5 * 2 = 10

  for (let i = 0; i < hardLimit; i++) {
    const result = await checkRateLimit({ clientId: "c1", action: "keepalive", repo });
    assert.equal(result.allowed, true, `request ${i + 1} should be allowed`);
  }
});

test("checkRateLimit rejects requests over hard limit", async () => {
  const repo = makeRepo();
  const softLimit = RATE_LIMITS.keepalive;   // 5
  const hardLimit = softLimit * HARD_LIMIT_MULTIPLIER; // 10

  // Exhaust the hard limit
  for (let i = 0; i < hardLimit; i++) {
    await checkRateLimit({ clientId: "c2", action: "keepalive", repo });
  }

  // Next request should be rejected
  const result = await checkRateLimit({ clientId: "c2", action: "keepalive", repo });
  assert.equal(result.allowed, false);
  assert.equal(result.hardLimit, hardLimit);
  assert.equal(result.softLimit, softLimit);
});

test("checkRateLimit tracks per-client independently", async () => {
  const repo = makeRepo();
  const hardLimit = RATE_LIMITS.keepalive * HARD_LIMIT_MULTIPLIER; // 10

  // Exhaust client A
  for (let i = 0; i < hardLimit; i++) {
    await checkRateLimit({ clientId: "clientA", action: "keepalive", repo });
  }
  const limitedA = await checkRateLimit({ clientId: "clientA", action: "keepalive", repo });
  assert.equal(limitedA.allowed, false);

  // Client B should still be allowed
  const allowedB = await checkRateLimit({ clientId: "clientB", action: "keepalive", repo });
  assert.equal(allowedB.allowed, true);
});

test("checkRateLimit tracks per-action independently", async () => {
  const repo = makeRepo();
  const keepaliveHard = RATE_LIMITS.keepalive * HARD_LIMIT_MULTIPLIER; // 10

  // Exhaust keepalive for client
  for (let i = 0; i < keepaliveHard; i++) {
    await checkRateLimit({ clientId: "c3", action: "keepalive", repo });
  }
  const limitedKeepalive = await checkRateLimit({ clientId: "c3", action: "keepalive", repo });
  assert.equal(limitedKeepalive.allowed, false);

  // state_update should still be allowed (separate counter)
  const allowedState = await checkRateLimit({ clientId: "c3", action: "state_update", repo });
  assert.equal(allowedState.allowed, true);
});

test("checkRateLimit uses default limit for unknown actions", async () => {
  const repo = makeRepo();
  const result = await checkRateLimit({ clientId: "c4", action: "unknown_action", repo });
  assert.equal(result.allowed, true);
  assert.equal(result.softLimit, RATE_LIMITS.default);
  assert.equal(result.hardLimit, RATE_LIMITS.default * HARD_LIMIT_MULTIPLIER);
});

test("checkRateLimit fails open on DDB error", async () => {
  const brokenRepo = {
    update: async () => { const e = new Error("DDB unavailable"); e.name = "ProvisionedThroughputExceededException"; throw e; }
  };
  const result = await checkRateLimit({ clientId: "c5", action: "keepalive", repo: brokenRepo });
  assert.equal(result.allowed, true); // fail open
});
