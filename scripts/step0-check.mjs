#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { loadLocalEnvFiles } from "./load-env.mjs";

loadLocalEnvFiles();

const args = new Set(process.argv.slice(2));
const showHelp = args.has("--help") || args.has("-h");
const askRequired = args.has("--ask-required");
const skipAsk = args.has("--skip-ask");
const jsonOut = args.has("--json");

if (showHelp) {
  console.log(`Usage: node scripts/step0-check.mjs [options]

Step 0 login/access verification for the clean SlideBolt repo.

Options:
  --skip-ask       Skip ASK CLI checks (AWS checks still run)
  --ask-required   Fail the run if ASK CLI checks fail or ASK CLI is missing
  --json           Print a JSON summary at the end
  -h, --help       Show this help

Checks:
  Required: aws binary, aws sts get-caller-identity, aws region, lambda list, dynamodb list-tables
  Optional: ask binary, ask util whoami
`);
  process.exit(0);
}

const results = [];

function record(name, ok, detail, required = true) {
  results.push({ name, ok, detail, required });
}

function run(cmd, cmdArgs, options = {}) {
  try {
    const out = execFileSync(cmd, cmdArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    return { ok: true, stdout: out.trim(), stderr: "" };
  } catch (err) {
    const stdout = err.stdout ? String(err.stdout).trim() : "";
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    return {
      ok: false,
      code: typeof err.status === "number" ? err.status : 1,
      stdout,
      stderr,
      message: err.message
    };
  }
}

function commandExists(cmd) {
  const res = spawnSync("bash", ["-lc", `command -v ${cmd}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return res.status === 0;
}

function shortError(res) {
  return res.stderr || res.stdout || res.message || "command failed";
}

function isAccessDenied(detail) {
  const s = String(detail || "");
  return s.includes("AccessDenied") || s.includes("AccessDeniedException") || s.includes("not authorized to perform");
}

function printLine(label, ok, detail, required = true) {
  const state = ok ? "PASS" : required ? "FAIL" : "WARN";
  console.log(`[${state}] ${label}${detail ? `: ${detail}` : ""}`);
}

console.log("Step 0: CLI login/access checks");
console.log("");

if (!commandExists("aws")) {
  record("aws binary", false, "aws CLI not found in PATH", true);
  printLine("aws binary", false, "aws CLI not found in PATH", true);
} else {
  record("aws binary", true, "found", true);
  printLine("aws binary", true, "found", true);

  const sts = run("aws", ["sts", "get-caller-identity", "--output", "json"]);
  if (!sts.ok) {
    record("aws sts get-caller-identity", false, shortError(sts), true);
    printLine("aws sts get-caller-identity", false, shortError(sts), true);
  } else {
    let account = "";
    let arn = "";
    try {
      const parsed = JSON.parse(sts.stdout || "{}");
      account = parsed.Account || "";
      arn = parsed.Arn || "";
    } catch {
      // Keep raw output if parse fails.
    }
    const detail = account ? `account=${account}${arn ? ` arn=${arn}` : ""}` : "ok";
    record("aws sts get-caller-identity", true, detail, true);
    printLine("aws sts get-caller-identity", true, detail, true);
  }

  const region = run("aws", ["configure", "get", "region"]);
  if (!region.ok || !region.stdout) {
    const msg = !region.ok ? shortError(region) : "no default region configured";
    record("aws region", false, msg, true);
    printLine("aws region", false, msg, true);
  } else {
    record("aws region", true, region.stdout, true);
    printLine("aws region", true, region.stdout, true);
  }

  const lambdaList = run("aws", ["lambda", "list-functions", "--max-items", "5", "--output", "json"]);
  if (!lambdaList.ok) {
    const detail = shortError(lambdaList);
    const limited = isAccessDenied(detail);
    record(
      "aws lambda list-functions",
      limited,
      limited ? "access denied (login works, list permission missing)" : detail,
      !limited
    );
    printLine(
      "aws lambda list-functions",
      limited,
      limited ? "access denied (login works, list permission missing)" : detail,
      !limited
    );
  } else {
    let count = "ok";
    try {
      const parsed = JSON.parse(lambdaList.stdout || "{}");
      count = `${Array.isArray(parsed.Functions) ? parsed.Functions.length : 0} returned`;
    } catch {
      // ignore
    }
    record("aws lambda list-functions", true, count, true);
    printLine("aws lambda list-functions", true, count, true);
  }

  const ddbList = run("aws", ["dynamodb", "list-tables", "--max-items", "5", "--output", "json"]);
  if (!ddbList.ok) {
    const detail = shortError(ddbList);
    const limited = isAccessDenied(detail);
    record(
      "aws dynamodb list-tables",
      limited,
      limited ? "access denied (login works, list permission missing)" : detail,
      !limited
    );
    printLine(
      "aws dynamodb list-tables",
      limited,
      limited ? "access denied (login works, list permission missing)" : detail,
      !limited
    );
  } else {
    let count = "ok";
    try {
      const parsed = JSON.parse(ddbList.stdout || "{}");
      count = `${Array.isArray(parsed.TableNames) ? parsed.TableNames.length : 0} returned`;
    } catch {
      // ignore
    }
    record("aws dynamodb list-tables", true, count, true);
    printLine("aws dynamodb list-tables", true, count, true);
  }
}

if (skipAsk) {
  record("ask checks", true, "skipped by flag", false);
  printLine("ask checks", true, "skipped by flag", false);
} else if (!commandExists("ask")) {
  record("ask binary", false, "ASK CLI not found in PATH", askRequired);
  printLine("ask binary", false, "ASK CLI not found in PATH", askRequired);
} else {
  record("ask binary", true, "found", false);
  printLine("ask binary", true, "found", false);

  const whoami = run("ask", ["util", "whoami"]);
  if (!whoami.ok) {
    record("ask util whoami", false, shortError(whoami), askRequired);
    printLine("ask util whoami", false, shortError(whoami), askRequired);
  } else {
    const detail = (whoami.stdout || "ok").split("\n").slice(0, 2).join(" | ");
    record("ask util whoami", true, detail, false);
    printLine("ask util whoami", true, detail, false);
  }
}

const requiredFailures = results.filter((r) => r.required && !r.ok);
const optionalFailures = results.filter((r) => !r.required && !r.ok);

console.log("");
console.log(
  `Summary: ${results.filter((r) => r.ok).length}/${results.length} checks passed` +
    ` (${requiredFailures.length} required failures, ${optionalFailures.length} optional failures)`
);

if (jsonOut) {
  console.log(JSON.stringify({ results, requiredFailures: requiredFailures.length, optionalFailures: optionalFailures.length }, null, 2));
}

if (requiredFailures.length > 0) {
  process.exit(1);
}
