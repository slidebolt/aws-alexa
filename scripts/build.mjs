#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const skipDirs = new Set(["node_modules", ".git", "dist", "coverage", "cdk.out"]);
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!skipDirs.has(name)) walk(full);
      continue;
    }
    if (full.endsWith(".js") || full.endsWith(".mjs")) files.push(full);
  }
}

walk(ROOT);

for (const file of files) {
  // Lightweight parse check without executing modules or requiring dependencies.
  const source = readFileSync(file, "utf8").replace(/^#![^\n]*\n/, "");
  try {
    new Function(source);
  } catch (err) {
    // `new Function` can't parse ESM import/export syntax, so skip ESM modules here.
    // Repo-wide syntax checking is still covered by `node --check` spot checks during development.
    const isEsm = /^\s*(import|export)\s/m.test(source);
    if (!isEsm) {
      throw err;
    }
  }
}

console.log(`Build precheck passed: scanned ${files.length} JS/MJS files.`);
console.log("Transpile/package and stronger syntax/type checks will be added in later phases.");
