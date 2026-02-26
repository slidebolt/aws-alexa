import { execFileSync } from "node:child_process";

export function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

export function info(msg) {
  console.log(msg);
}

export function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

