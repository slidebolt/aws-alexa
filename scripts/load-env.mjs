#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnvFiles({
  cwd = process.cwd(),
  files = [".env.aws", ".env.local", ".env"]
} = {}) {
  for (const rel of files) {
    const full = path.join(cwd, rel);
    if (!existsSync(full)) continue;
    const raw = readFileSync(full, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

