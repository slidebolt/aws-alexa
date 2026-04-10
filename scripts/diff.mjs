#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { loadLocalEnvFiles } from "./load-env.mjs";

loadLocalEnvFiles();

const stackName = process.env.CDK_STACK_NAME || "SldBltProdStack";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

if (!process.env.ADMIN_SECRET) {
  console.error("Missing required env var: ADMIN_SECRET");
  process.exit(1);
}
if (!process.env.RELAY_TOKEN) {
  console.error("Missing required env var: RELAY_TOKEN");
  process.exit(1);
}
if (!process.env.ALEXA_SKILL_ID) {
  console.error("Missing required env var: ALEXA_SKILL_ID");
  process.exit(1);
}
if (!process.env.ALEXA_CLIENT_ID) {
  console.error("Missing required env var: ALEXA_CLIENT_ID");
  process.exit(1);
}
if (!process.env.ALEXA_CLIENT_SECRET) {
  console.error("Missing required env var: ALEXA_CLIENT_SECRET");
  process.exit(1);
}
if (!process.env.ALEXA_REDIRECT_URI) {
  console.error("Missing required env var: ALEXA_REDIRECT_URI");
  process.exit(1);
}

execFileSync("npx", [
  "cdk",
  "diff",
  stackName,
  "--parameters",
  `AdminSecret=${process.env.ADMIN_SECRET}`,
  "--parameters",
  `RelayToken=${process.env.RELAY_TOKEN}`,
  "--parameters",
  `AlexaSkillId=${process.env.ALEXA_SKILL_ID}`
], {
  cwd: "infra",
  stdio: "inherit",
  env: { ...process.env, AWS_REGION: region, AWS_DEFAULT_REGION: region }
});
