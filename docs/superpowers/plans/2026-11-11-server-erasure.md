# Server Erasure Implementation Plan

> For agentic workers: implement this source-only plan task by task, with failing tests before behavior changes and an independent review before completion.

**Goal:** Implement truthful, owner-scoped learner and account erasure without touching live data.

**Architecture:** Extend the existing backend store/API with narrow erasure functions, receipts and tombstones; connect native lifecycle state only after the contract is tested. Keep provider account erasure separate from app-data erasure until its durable orchestration is implemented.

**Tech Stack:** Go, PostgreSQL, Kotlin, Swift; existing bounded transports.

**Spec:** `docs/superpowers/specs/2026-11-11-server-erasure-design.md`

## Global constraints

- No deployments, live migrations, credential changes, account operations or real-data deletion.
- Preserve device learning history; require explicit confirmation and recent authentication for server erasure.
- Keep direct runtime DELETE/TRUNCATE/DDL denied.
- Do not claim provider deletion, legal approval or retention guarantees without implementation/evidence.

## Review focus

- Foreign users and reused identifiers must not reveal or delete another person's data.
- Lost responses and restarts must preserve request identity and recover the exact receipt.
- Concurrent uploads/creates must not recreate erased content.
- Parent removal must not silently delete dependent child profiles.
- Learning-readiness rollback must not remove a user's erasure access.

## Task 1: Learner erasure backend

- [x] Add failing HTTP and store integration tests for the specified lifecycle and refusal cases.
- [x] Add an additive erasure migration, store operation/receipt, narrow grants and startup checks.
- [x] Add confirmed, fresh-auth HTTP routing and ingress validation.
- [x] Run full disposable PostgreSQL race suite and Go vet, including direct-privilege denial checks.

## Task 2: Native learner erasure

- [x] Add failing transport and lifecycle tests for confirmation, uncertain replies, owner isolation and restart.
- [x] Add exact receipt parsing and durable pending request state without deleting local learning history.
- [x] Add truthful native UI and error handling; do not expose unfinished account erasure as complete.
- [x] Run affected native suites and required repository gates.

## Task 3: Full account/provider deletion

- [x] Implement the source-only provider adapter with explicit HTTPS/issuer/credential input and isolated TLS tests.
- [x] Implement durable account request coordination, provider lease/retry, proof-only status and explicit runtime configuration in source; no live activation.
- [x] Add failure/retry/stale-token tests with isolated services and database.
- [ ] Wire clients only once the complete deletion contract is verified.
- [x] Keep actual provider credentials, runtime grants and deployment separately blocked on authorization.

## Task 4: Privacy disclosure correction

- [x] Replace false no-account/no-server/no-upload statements with observed behavior.
- [x] Separate implemented functionality from deployment/provider/retention/legal acceptance still pending.
- [x] Review the learner/provider/core diff and record verified results, unresolved decisions and rollout prerequisites; final account API/runtime review recorded separately.

## Verified checkpoint

Backend: 141 top-level disposable PostgreSQL/race tests passed, two subprocess helpers skipped; Go vet passed. Android: 663 reported tests across engine/content/data/sync/demo, 652 passed and 11 optional live-wire skips; prod lint has 0 errors, 637 warnings and 3 hints, unsigned prodRelease assembly and six exact asset checks passed. ktlint is report-only. Swift: 68 tests and 20 Python checks passed; unsigned iOS ARM64 simulator app compiled without installation. Independent backend and Android erasure review found no blocking issue. Full account orchestration, public configuration, deployment and real-account/device acceptance remain open.

Account follow-up: 157 top-level disposable PostgreSQL/race passes and two helper skips; Go vet and focused provider checks pass. Full backend account coordinator/status/gateway/runtime source now exists. Native full-account lifecycle, actual provider acceptance, deployment, public web process and retention/backup operations remain open. See `docs/integration/ACCOUNT_ERASURE_READINESS.md`. Supplemental demo lint/assembly passed (220 Gradle tasks).
