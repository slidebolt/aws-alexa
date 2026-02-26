import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const runE2E = process.env.RUN_AWS_E2E === "1";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

function invokeLambda(functionName, payload) {
  const dir = mkdtempSync(join(tmpdir(), "sldblt-e2e-"));
  const inFile = join(dir, "in.json");
  const outFile = join(dir, "out.json");
  try {
    writeFileSync(inFile, JSON.stringify(payload));
    execFileSync("aws", [
      "lambda",
      "invoke",
      "--function-name",
      functionName,
      "--region",
      region,
      "--payload",
      `fileb://${inFile}`,
      outFile
    ], { stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(readFileSync(outFile, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("AWS lambda invoke smoke: SldBltRelay returns structured error for invalid JSON", { skip: !runE2E }, async () => {
  const res = invokeLambda("SldBltRelay", {
    body: "{bad",
    requestContext: { routeKey: "register", connectionId: "smoke-1" }
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Invalid JSON body/);
});

test("AWS lambda invoke smoke: SldBltAdmin returns structured error for invalid JSON", { skip: !runE2E }, async () => {
  const res = invokeLambda("SldBltAdmin", {
    body: "{bad",
    requestContext: { routeKey: "admin_list_clients", connectionId: "smoke-1" }
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /Invalid JSON body/);
});

test("AWS lambda invoke smoke: SldBltSmartHome discovery returns Alexa response", { skip: !runE2E }, async () => {
  const res = invokeLambda("SldBltSmartHome", {
    directive: {
      header: {
        namespace: "Alexa.Discovery",
        name: "Discover",
        payloadVersion: "3",
        messageId: "smoke-disc-1"
      },
      payload: { scope: { clientId: "nonexistent-client" } }
    }
  });
  assert.equal(res.event.header.namespace, "Alexa.Discovery");
  assert.equal(res.event.header.name, "Discover.Response");
  assert.ok(Array.isArray(res.event.payload.endpoints));
});

test("AWS lambda invoke smoke: SldBltReporter handles empty stream event", { skip: !runE2E }, async () => {
  const res = invokeLambda("SldBltReporter", { Records: [] });
  assert.equal(res.ok, true);
  assert.equal(res.processed, 0);
});

