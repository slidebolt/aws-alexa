#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { loadLocalEnvFiles } from "./load-env.mjs";

loadLocalEnvFiles();

const args = new Set(process.argv.slice(2));
const stackName = getArgValue("--stack-name") || process.env.CDK_STACK_NAME || "SldBltProdStack";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

function getArgValue(flag) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(flag);
  if (idx === -1) return "";
  return argv[idx + 1] || "";
}

function runAws(cmdArgs) {
  return execFileSync("aws", cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function ok(label, detail) {
  console.log(`[PASS] ${label}${detail ? `: ${detail}` : ""}`);
}

function fail(label, detail) {
  console.error(`[FAIL] ${label}${detail ? `: ${detail}` : ""}`);
  process.exitCode = 1;
}

function warn(label, detail) {
  console.warn(`[WARN] ${label}${detail ? `: ${detail}` : ""}`);
}

function formatErr(err) {
  return err?.stderr ? String(err.stderr).trim() : err?.message || String(err);
}

function isAccessDenied(detail) {
  return /AccessDenied/i.test(String(detail));
}

console.log(`Post-deploy checks for stack=${stackName} region=${region}`);

let outputs = [];
try {
  const raw = runAws([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--query",
    "Stacks[0].Outputs",
    "--output",
    "json"
  ]);
  outputs = JSON.parse(raw || "[]");
  ok("CloudFormation stack", `${outputs.length} outputs`);
} catch (err) {
  fail("CloudFormation stack", formatErr(err));
}

for (const fn of ["SldBltRelay", "SldBltReporter", "SldBltAdmin", "SldBltSmartHome"]) {
  try {
    const arn = runAws([
      "lambda",
      "get-function",
      "--function-name",
      fn,
      "--region",
      region,
      "--query",
      "Configuration.FunctionArn",
      "--output",
      "text"
    ]);
    ok(`Lambda ${fn}`, arn);
  } catch (err) {
    const detail = formatErr(err);
    if (isAccessDenied(detail)) {
      warn(`Lambda ${fn}`, `${detail} (read check skipped due IAM restrictions)`);
    } else {
      fail(`Lambda ${fn}`, detail);
    }
  }
}

try {
  const status = runAws([
    "dynamodb",
    "describe-table",
    "--table-name",
    "SldBltData-v1-prod",
    "--region",
    region,
    "--query",
    "Table.TableStatus",
    "--output",
    "text"
  ]);
  ok("DynamoDB SldBltData-v1-prod", status);
} catch (err) {
  const detail = formatErr(err);
  if (isAccessDenied(detail)) {
    warn("DynamoDB SldBltData-v1-prod", `${detail} (read check skipped due IAM restrictions)`);
  } else {
    fail("DynamoDB SldBltData-v1-prod", detail);
  }
}

const wsUrl = outputs.find((o) => o.OutputKey === "WebSocketUrl")?.OutputValue;
const wsMgmtUrl = outputs.find((o) => o.OutputKey === "WebSocketMgmtUrl")?.OutputValue;
if (wsUrl) ok("WebSocketUrl output", wsUrl);
else fail("WebSocketUrl output", "missing");
if (wsMgmtUrl) ok("WebSocketMgmtUrl output", wsMgmtUrl);
else fail("WebSocketMgmtUrl output", "missing");

if (process.exitCode) process.exit(process.exitCode);
