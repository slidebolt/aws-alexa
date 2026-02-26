import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeConfig, optionalEnv, requireEnv } from "../../shared/config/env.mjs";

test("requireEnv returns value", () => {
  assert.equal(requireEnv("DATA_TABLE", { DATA_TABLE: "SldBltData-v1-prod" }), "SldBltData-v1-prod");
});

test("requireEnv throws when missing", () => {
  assert.throws(() => requireEnv("DATA_TABLE", {}), /Missing required env var: DATA_TABLE/);
});

test("optionalEnv returns fallback on empty", () => {
  assert.equal(optionalEnv("X", "fallback", { X: "" }), "fallback");
  assert.equal(optionalEnv("X", "fallback", {}), "fallback");
});

test("loadRuntimeConfig enforces DATA_TABLE and reads optional values", () => {
  const cfg = loadRuntimeConfig({
    DATA_TABLE: "SldBltData-v1-prod",
    WS_MGMT_ENDPOINT: "https://example.invalid/prod",
    ADMIN_SECRET: "abc"
  });
  assert.equal(cfg.dataTable, "SldBltData-v1-prod");
  assert.equal(cfg.wsMgmtEndpoint, "https://example.invalid/prod");
  assert.equal(cfg.adminSecret, "abc");
  assert.equal(cfg.alexaClientId, "");
});

