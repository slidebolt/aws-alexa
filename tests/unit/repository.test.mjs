import test from "node:test";
import assert from "node:assert/strict";
import { createDataTableRepository } from "../../shared/dynamo/repository.mjs";

test("repository binds only DATA_TABLE", async () => {
  const calls = [];
  const fakeTable = {
    get: async (key) => {
      calls.push(["get", key]);
      return { Item: null };
    },
    put: async (item) => {
      calls.push(["put", item]);
      return {};
    },
    update: async (...args) => {
      calls.push(["update", ...args]);
      return {};
    },
    delete: async (key) => {
      calls.push(["delete", key]);
      return {};
    },
    scan: async (...args) => {
      calls.push(["scan", ...args]);
      return { Items: [] };
    },
    query: async (...args) => {
      calls.push(["query", ...args]);
      return { Items: [] };
    }
  };
  const db = (tableName) => {
    calls.push(["db", tableName]);
    return fakeTable;
  };

  const repo = createDataTableRepository({ db, env: { DATA_TABLE: "SldBltData-v1-prod" } });
  assert.equal(repo.tableName, "SldBltData-v1-prod");
  await repo.get({ pk: "CLIENT#c1", sk: "METADATA" });
  await repo.query("pk = :pk", { ":pk": "CLIENT#c1" }, "GSI1");
  assert.deepEqual(calls[0], ["db", "SldBltData-v1-prod"]);
  assert.deepEqual(calls[1], ["get", { pk: "CLIENT#c1", sk: "METADATA" }]);
  assert.deepEqual(calls[2], ["query", "pk = :pk", { ":pk": "CLIENT#c1" }, "GSI1"]);
});

test("repository throws without DATA_TABLE", () => {
  assert.throws(
    () => createDataTableRepository({ db: () => ({}) , env: {} }),
    /Missing required env var: DATA_TABLE/
  );
});

