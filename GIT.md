# Git Workflow for aws-alexa

This repository contains the Slidebolt AWS cloud components for Alexa integration, including the Smart Home Skill lambda, WebSocket relay, and reporting services.

## Dependencies
- **Internal:** None (Standalone JS/TS project).
- **External:** 
  - `@aws-sdk/*`: AWS SDK for JavaScript v3.
  - AWS CDK: Infrastructure as Code (in `infra/`).

## Build Process
- **Type:** Node.js Application (AWS CDK / Serverless).
- **Consumption:** Deployed to AWS via CDK.
- **Artifacts:** 
  - Lambda functions (bundled from `services/`).
  - DynamoDB tables and API Gateway configurations.
- **Commands:**
  - Build: `npm run build`
  - Synth: `npm run synth`
- **Validation:** 
  - Unit Tests: `npm run test`
  - Integration Tests: `npm run test:integration`
  - Full Verification: `npm run verify`

## Pre-requisites & Publishing
This repository can be updated independently of the Go-based plugins, but it is often updated in tandem with `plugin-alexa`.

**Before publishing:**
1. Determine current tag: `git tag | sort -V | tail -n 1`
2. Ensure all tests pass: `npm run verify`
3. Ensure CDK synth is clean: `npm run synth`

**Publishing Order:**
1. Update source code.
2. Determine next semantic version (e.g., `v1.0.4`).
3. Commit and push the changes to `main`.
4. Tag the repository: `git tag v1.0.4`.
5. Push the tag: `git push origin main v1.0.4`.

## Update Workflow & Verification
1. **Modify:** Update lambda logic in `services/` or shared logic in `shared/`.
2. **Verify Local:**
   - Run `npm test`.
   - Run `npm run synth` to verify infrastructure changes.
3. **Commit:** Ensure the commit message describes logic or infrastructure changes.
4. **Tag & Push:** (Follow the Publishing Order above).
