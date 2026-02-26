import { requireEnv } from "../config/env.mjs";

export function createDataTableRepository({ db, env = process.env } = {}) {
  if (!db || typeof db !== "function") {
    throw new Error("createDataTableRepository requires a db(tableName) function");
  }
  const tableName = requireEnv("DATA_TABLE", env);
  const table = db(tableName);
  return {
    tableName,
    get: (key) => table.get(key),
    put: (item) => table.put(item),
    update: (key, updateExp, names, values, conditionExp) =>
      table.update(key, updateExp, names, values, conditionExp),
    delete: (key) => table.delete(key),
    scan: (filterExp, values) => table.scan(filterExp, values),
    query: (keyCondition, values, indexName) => table.query(keyCondition, values, indexName)
  };
}

