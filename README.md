# SlideBolt Clean Reference Rebuild

This directory (`git/`) is the clean rebuild workspace for migrating the SlideBolt reference implementation into a new repository.

## Scope (Current)

- DynamoDB tables used by runtime: `SldBltData-v1-prod` only
- Lambda functions (deployed names):
  - `SldBltRelay`
  - `SldBltReporter`
  - `SldBltAdmin`
  - `SldBltSmartHome`

## Non-goals / Legacy (Do Not Reintroduce)

- Legacy DynamoDB tables: `SldBltUsers-prod`, `SldBltDevices-prod`, `SldBltState-prod`, `SldBltState-v2-prod`, `SlideBoltState`
- Lowercase duplicate Lambda deployments: `slideBoltWsRelay`, `slideBoltSmartHome`
- Hardcoded local filesystem paths (for example an absolute user home path)
- Committed ASK local state (`skill/.ask/`)

## Step 0 (Login / Access Check)

Run:

```bash
npm run step0
```

Optional:

```bash
npm run step0 -- --skip-ask
npm run step0 -- --ask-required
```

## Planned Layout

- `infra/` CDK stack (single table + 4 lambdas + WebSocket + permissions)
- `services/` runtime services (relay/admin/smarthome/reporter)
- `shared/` reusable modules (dynamo, config, alexa, ws, types)
- `tests/` unit/integration/e2e
- `scripts/` repo checks, build/test wrappers, deployment helpers

## Repo Quality Gates

Use:

```bash
npm run verify
```

Full local validation (includes in-memory integration flow test):

```bash
npm run verify:full
```

## Deploy (AWS)

Required env vars:

- `WS_SHARED_SECRET`
- `ALEXA_SKILL_ID`

Optional:
- `CDK_STACK_NAME` (defaults to `SldBltProdStack`)

Commands:

```bash
npm run infra:install
npm run deploy
```

Post-deploy checks only:

```bash
npm run deploy:check
```

AWS e2e smoke test (opt-in):

```bash
RUN_AWS_E2E=1 npm run test:e2e
```

Current e2e smoke coverage:
- CloudFormation stack exists and is complete
- `SldBltData-v1-prod` exists and is ACTIVE
- `SldBltRelay`, `SldBltReporter`, `SldBltAdmin`, `SldBltSmartHome` are Active
- Lambda invoke smoke:
  - relay/admin invalid JSON handling
  - smarthome discovery response shape
  - reporter empty-stream handling

Current `verify` runs placeholder build/test/synth scripts plus repo guardrails:
- no absolute `/home/` paths
- no legacy table names
- no lowercase duplicate lambda names
