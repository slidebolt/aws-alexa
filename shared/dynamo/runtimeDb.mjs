import { createAwsDbFactory } from "./client.mjs";

let dbFactoryPromise;

export function getRuntimeDbFactory() {
  if (!dbFactoryPromise) {
    dbFactoryPromise = createAwsDbFactory();
  }
  return dbFactoryPromise;
}

