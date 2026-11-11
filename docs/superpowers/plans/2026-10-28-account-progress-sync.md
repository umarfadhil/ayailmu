# Account Progress Sync Implementation Plan

> **For agentic workers:** Use the approved single Sonnet 5.5 xhigh writer, task-by-task; coordinator verifies RED/GREEN, freezes tests and obtains independent review. Existing owner instruction opts out of another planning approval round.

**Goal:** Durable account-bound answer queue updates and truthful progress/sync status in the real learner flow.

**Architecture:** Pure projection over the existing journal and a same-account/profile verified progress receipt. A dataset-fenced local notification follows saved choices; existing manual sync remains the only transmission path. Remote lesson state is not fabricated.

**Tech Stack:** Expo 58, React Native 0.88, TypeScript, existing SQLite/KvStore, Supabase SDK and Go answer API contract.

**Spec:** docs/superpowers/specs/2026-10-28-account-progress-sync-design.md

## Global constraints
- Preserve all 196 frozen tests/helpers, content approval, guest consent/isolation and deferred recovery.
- Team/Pro Sonnet 5.5 xhigh first; Max Opus xhigh only after actual exhaustion, no paid overages or fallback.
- No credentials, mail, live account changes, public exposure, signing or publication.
- No new API contract or automatic network calls. Existing current-device lesson resume remains local.

## Review focus
- A late queue callback cannot borrow the next account's journal or display state.
- Blocked/capture-held/newly saved answers prevent an all-sent claim.
- Unregistered-but-stored answers must not disappear from the account's saved count or become mastery.
- Unknown/stale/foreign receipts must not become verified zero or leak another profile's count.
- A notification/storage failure must not undo or duplicate the learner's saved answer.

### Task 1: Factual account progress projection
**Files:** new `app/src/sync/accountProgress.ts`, new `app/src/sync/__tests__/accountProgress.test.ts`.
**Consumes:** `JournalView`, account-bound `AccountProgress` receipt and capture-pending flag.
**Produces:** typed sendable/blocked/conflict/acknowledged counts and verified/stale/unknown server totals.
- [x] Write regressions and minimal throwing interface stub; run RED and freeze the test.
- [x] Implement pure projection, safe integer checks, exact account/profile/family binding and unknown-not-zero behavior.
- [x] Run GREEN and focused journal compatibility tests.

### Task 2: Real queue and sync lifecycle wiring
**Files:** `AccountContext.tsx`, `AppContext.tsx`, Unit A route/screen; new focused integration/UI tests only.
**Consumes:** Task1 projection and existing binding/store/journal APIs.
**Produces:** optional dataset-scoped `answersSaved` callback and current account progress facts.
- [x] Pin RED regressions for binding, guarded writes, receipts, UI notification and held-capture/sync races; retain existing SDK/store/journal retry, interruption and isolation coverage.
- [x] Freeze and implement local reconciliation callback outside storage writers; preserve choices on failure.
- [x] Refresh final local queue after sync and derive status from current facts; keep refresh-before-send and existing endpoints.
- [x] Verify GREEN without changing any frozen assertions.

### Task 3: Compact learner-facing status and final checkpoint
**Files:** `StarterHome.tsx`, account panel and a focused shared status view if useful; new UI tests; documentation.
**Consumes:** same bound progress model and existing manual sync callback.
**Produces:** factual saved/queued/held/unknown/stale presentation, retry action and local-resume limitation.
- [x] RED/GREEN UI tests for no false zero/all-sent/mastery, stale and unknown counts, and unchanged pending-review/guest paths.
- [x] Independent read-only source review; repair the held-capture finding with two frozen integration regressions and obtain a second review. Coordinator checked the diff scope separately.
- [x] Full tests/typecheck/project lint, all protected hashes, JS exports and rendered checks within loopback-only scope.
- [x] Prepare a passing local-only checkpoint and exact evidence; preserve remaining live/native gates. No push or signing.

## Verified result (2026-10-29)

See [account-progress-sync-verification.md](../../verification/2026-10-29-account-progress-sync.md). Full suite: 2,014 passed, 2 intentional platform-specific skips; all 205 frozen files unchanged. TypeScript, project lint and web/iOS/Android JavaScript exports pass. Browser smoke tests preserve the pending-review gate and safe navigation. Live backend, native build/device acceptance and distribution are not claimed by this checkpoint.
