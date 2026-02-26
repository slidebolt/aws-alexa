#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const requireReal = process.argv.includes("--real");
const INFRA = path.join(ROOT, "infra");
const stackFile = path.join(INFRA, "lib", "stack.mjs");
const appFile = path.join(INFRA, "bin", "app.mjs");
const pkgFile = path.join(INFRA, "package.json");
const cdkBin = path.join(INFRA, "node_modules", ".bin", "cdk");

for (const file of [pkgFile, appFile, stackFile]) {
  if (!existsSync(file)) {
    console.error(`Synth precheck failed: missing ${path.relative(ROOT, file)}`);
    process.exit(1);
  }
}

const stackSrc = readFileSync(stackFile, "utf8");
const requiredMarkers = [
  "const prefix = \"SldBlt\"",
  "tableName: `${prefix}Data-v1-${stage}`",
  "functionName: `${prefix}Relay`",
  "functionName: `${prefix}Reporter`",
  "functionName: `${prefix}Admin`",
  "functionName: `${prefix}SmartHome`",
  "WebSocketApi",
  "DynamoEventSource",
  "AlexaSmartHomeInvoke"
];

for (const marker of requiredMarkers) {
  if (!stackSrc.includes(marker)) {
    console.error(`Synth precheck failed: expected marker missing in infra stack: ${marker}`);
    process.exit(1);
  }
}

if (!existsSync(cdkBin)) {
  if (requireReal) {
    console.error("Real synth requested but infra dependencies are not installed. Run `npm run infra:install` first.");
    process.exit(1);
  }
  console.log("Synth precheck passed: infra scaffold exists and contains required resources.");
  console.log("Skipping real `cdk synth` because infra dependencies are not installed yet.");
  process.exit(0);
}

try {
  const res = spawnSync(cdkBin, ["synth"], {
    cwd: INFRA,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"]
  });
  if (res.status !== 0) {
    const stderr = res.stderr ? String(res.stderr).trim() : "cdk synth failed";
    console.error(stderr);
    process.exit(res.status || 1);
  }
  if (res.stderr && String(res.stderr).trim()) {
    console.log(String(res.stderr).trim());
  } else {
    console.log("Real `cdk synth` completed successfully.");
  }
} catch (err) {
  console.error(err?.message || "cdk synth failed");
  process.exit(1);
}
