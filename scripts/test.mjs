#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const suite = process.argv[2] || "unit";
if (!["unit", "integration", "e2e"].includes(suite)) {
  console.error(`Unknown suite: ${suite}`);
  process.exit(1);
}

const dir = path.join(process.cwd(), "tests", suite);
if (!existsSync(dir)) {
  console.error(`Missing test directory: tests/${suite}`);
  process.exit(1);
}

const testFiles = readdirSync(dir)
  .filter((name) => name.endsWith(".test.mjs") || name.endsWith(".test.js"))
  .map((name) => path.join(dir, name));

if (testFiles.length === 0) {
  console.log(`Test placeholder: ${suite} tests not implemented yet.`);
  console.log("This command is a scaffold target for the migration phases.");
  process.exit(0);
}

try {
  execFileSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit"
  });
} catch (err) {
  process.exit(typeof err.status === "number" ? err.status : 1);
}
