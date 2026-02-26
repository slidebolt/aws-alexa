# Migration Plan (Execution Checklist)

## Phase 1: Scope Lock

- [ ] Confirm kept resources:
  - [ ] DynamoDB: `SldBltData-v1-prod`
  - [ ] Lambdas: `SldBltRelay`, `SldBltReporter`, `SldBltAdmin`, `SldBltSmartHome`
- [ ] Confirm out-of-scope legacy resources
- [ ] Document preserved user flows

Acceptance criteria:
- [ ] Scope document matches current inventory decisions
- [ ] Legacy resources are explicitly excluded

## Phase 2: Clean Repo Skeleton

- [x] Create `git/` root and base directories
- [x] Add `step0` login/access check
- [x] Add repo guardrails and placeholder build/test/synth/deploy scripts
- [x] Add `.env.example` and docs
- [x] Add unit tests and in-memory integration flow test scaffolding

Acceptance criteria:
- [ ] `npm run step0 -- --help` succeeds
- [ ] `npm run verify` succeeds locally

## Phase 3: CDK Infrastructure (Single Table + 4 Lambdas)

- [ ] Create new CDK app in `infra/`
- [ ] Provision only `SldBltData-v1-prod`
- [ ] Provision `SldBltRelay`, `SldBltReporter`, `SldBltAdmin`, `SldBltSmartHome`
- [ ] Add WebSocket API routes
- [ ] Add reporter stream trigger on data table
- [ ] Add Alexa invoke permission on Smart Home lambda

Acceptance criteria:
- [ ] `npm run synth` succeeds with generated template
- [ ] Synth template contains exactly 1 DynamoDB table and 4 lambdas

## Phase 4: Shared Core

- [ ] Env/config validation
- [ ] Single-table key builders + repo helpers
- [ ] WS client helpers
- [ ] Alexa helpers

Acceptance criteria:
- [ ] Unit tests cover shared modules
- [ ] No inline Dynamo key strings in handlers

## Phase 5: Service Porting

- [ ] Relay
- [ ] Admin
- [ ] SmartHome
- [ ] Reporter

Acceptance criteria:
- [x] All data access uses `DATA_TABLE` in clean scaffolded runtime modules
- [ ] Core flows match reference behavior

## Phase 6: Tests

- [ ] Unit tests
- [x] Integration tests (in-memory single-table flow scaffold)
- [ ] E2E smoke tests

Acceptance criteria:
- [ ] `npm run test`
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e`

## Phase 7: Deploy / Ops

- [x] Parameterized deploy scripts (no local paths)
- [x] Post-deploy verification
- [ ] Rollback notes

Acceptance criteria:
- [x] Fresh machine/CI deploy script path exists without source edits
- [ ] Deploy validated in target AWS account

## Phase 8: Cutover

- [ ] New remote repo initialization
- [ ] Non-destructive validation against existing `SldBltData-v1-prod`
- [ ] Reference repo archived/read-only usage

Acceptance criteria:
- [ ] New repo is independently buildable and deployable
