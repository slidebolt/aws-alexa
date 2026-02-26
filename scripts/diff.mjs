#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { loadLocalEnvFiles } from "./load-env.mjs";

loadLocalEnvFiles();

const stackName = process.env.CDK_STACK_NAME || "SldBltProdStack";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

if (!process.env.WS_SHARED_SECRET) {
  console.error("Missing required env var: WS_SHARED_SECRET");
  process.exit(1);
}
if (!process.env.ALEXA_SKILL_ID) {
  console.error("Missing required env var: ALEXA_SKILL_ID");
  process.exit(1);
}

execFileSync("npx", [
  "cdk",
  "diff",
  stackName,
  "--parameters",
  `WsSharedSecret=${process.env.WS_SHARED_SECRET}`,
  "--parameters",
  `AlexaSkillId=${process.env.ALEXA_SKILL_ID}`
], {
  cwd: "infra",
  stdio: "inherit",
  env: { ...process.env, AWS_REGION: region, AWS_DEFAULT_REGION: region }
});

