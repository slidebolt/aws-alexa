#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SldBltStack } from "../lib/stack.mjs";

const app = new cdk.App();

new SldBltStack(app, "SldBltProdStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1"
  }
});
