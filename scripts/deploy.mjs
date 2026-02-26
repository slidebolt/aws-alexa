#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { loadLocalEnvFiles } from "./load-env.mjs";

loadLocalEnvFiles();

const args = new Set(process.argv.slice(2));
const stackName = getArgValue("--stack-name") || process.env.CDK_STACK_NAME || "SldBltProdStack";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const requireStep0 = !args.has("--skip-step0");
const skipVerify = args.has("--skip-verify");
const skipPost = args.has("--skip-postcheck");

function getArgValue(flag) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(flag);
  if (idx === -1) return "";
  return argv[idx + 1] || "";
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
}

if (!process.env.WS_SHARED_SECRET) {
  console.error("Missing required env var: WS_SHARED_SECRET");
  process.exit(1);
}
if (!process.env.ALEXA_SKILL_ID) {
  console.error("Missing required env var: ALEXA_SKILL_ID");
  process.exit(1);
}

if (requireStep0) {
  run("node", ["scripts/step0-check.mjs", "--skip-ask"]);
}
if (!skipVerify) {
  run("node", ["scripts/build.mjs"]);
  run("node", ["scripts/test.mjs", "unit"]);
}

run("node", ["scripts/synth.mjs", "--real"]);

run("npm", ["run", "synth"], { cwd: "infra" }); // human-readable local synth output if desired, before deploy
run("npx", [
  "cdk",
  "deploy",
  stackName,
  "--require-approval",
  "never",
  "--parameters",
  `WsSharedSecret=${process.env.WS_SHARED_SECRET}`,
  "--parameters",
  `AlexaSkillId=${process.env.ALEXA_SKILL_ID}`,
  "--outputs-file",
  "cdk-outputs.json"
], { cwd: "infra", env: { ...process.env, AWS_REGION: region, AWS_DEFAULT_REGION: region } });

if (!skipPost) {
  run("node", ["scripts/postdeploy-check.mjs", "--stack-name", stackName], {
    env: { ...process.env, AWS_REGION: region, AWS_DEFAULT_REGION: region }
  });
}
