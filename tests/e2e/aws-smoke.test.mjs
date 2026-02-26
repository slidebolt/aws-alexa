import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const runE2E = process.env.RUN_AWS_E2E === "1";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const stackName = process.env.CDK_STACK_NAME || "SldBltProdStack";

function aws(args) {
  return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("AWS smoke: stack, lambdas, and data table exist", { skip: !runE2E }, async () => {
  const stackStatus = aws([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--query",
    "Stacks[0].StackStatus",
    "--output",
    "text"
  ]);
  assert.match(stackStatus, /_COMPLETE$/);

  for (const fn of ["SldBltRelay", "SldBltReporter", "SldBltAdmin", "SldBltSmartHome"]) {
    const state = aws([
      "lambda",
      "get-function",
      "--function-name",
      fn,
      "--region",
      region,
      "--query",
      "Configuration.State",
      "--output",
      "text"
    ]);
    assert.equal(state, "Active");
  }

  const tableStatus = aws([
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
  assert.equal(tableStatus, "ACTIVE");
});
