#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", "cdk.out"]);
const TEXT_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".json", ".md", ".yml", ".yaml", ".sh", ".txt"
]);

const checks = [
  {
    name: "No hardcoded /home/ paths",
    pattern: /\/home\/[A-Za-z0-9._/-]+/g,
    allow: []
  },
  {
    name: "No legacy table names",
    pattern: /\b(SldBltUsers-prod|SldBltDevices-prod|SldBltState-prod|SldBltState-v2-prod|SlideBoltState)\b/g,
    allow: [/README\.md$/, /PLAN\.md$/, /repo-guard\.mjs$/]
  },
  {
    name: "No lowercase duplicate lambda deployments",
    pattern: /\b(slideBoltWsRelay|slideBoltSmartHome)\b/g,
    allow: [/README\.md$/, /PLAN\.md$/, /repo-guard\.mjs$/]
  }
];

function isTextFile(path) {
  for (const ext of TEXT_EXTS) {
    if (path.endsWith(ext)) return true;
  }
  return false;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full) || ".";
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, files);
      continue;
    }
    if (isTextFile(rel)) files.push(full);
  }
  return files;
}

function lineFor(content, index) {
  return content.slice(0, index).split("\n").length;
}

const files = walk(ROOT);
let failures = 0;

for (const check of checks) {
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (check.allow.some((re) => re.test(rel))) continue;
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(check.pattern)) {
      hits.push(`${rel}:${lineFor(content, match.index ?? 0)} -> ${match[0]}`);
    }
  }

  if (hits.length === 0) {
    console.log(`[PASS] ${check.name}`);
  } else {
    failures += 1;
    console.log(`[FAIL] ${check.name}`);
    for (const hit of hits) {
      console.log(`  ${hit}`);
    }
  }
}

if (failures > 0) process.exit(1);

