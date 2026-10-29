# Private Tester Starter Implementation Plan

> **For agentic workers:** Execute task-by-task using the existing single Claude Opus 5.5 HIGH writer; coordinator runs verification/review. Prior user instructions already authorize implementation without another planning handoff.

**Goal:** A review-gated starter entry, account-bound durable pilot answers through the existing backend contract, and a fail-closed connected beta build profile.

**Architecture:** Reuse Unit A's controller and account stores. A compiled review manifest binds approval to exact content; the default is pending. Capture genuine pilot answers as existing v2 answer records without fabricating sync events or claiming full remote controller restoration.

**Tech Stack:** Expo 58 / React Native 0.88, TypeScript, Jest, SQLite/SecureStore, existing GoTrue and answer journal API.

**Spec:** docs/superpowers/specs/2026-10-27-private-tester-starter-design.md

## Global Constraints
- Single writer; protected baseline test/helper files must not change.
- Four-choice questions; stable content/data IDs; no automatic content approval.
- No invented origins, signing identity, grants, recovery emails or publication.
- Account/guest isolation; truthful first-answer provenance; refresh-before-sync stays intact.
- Default beta is unavailable until real configuration/review decisions exist.

## Review Focus
- Stale/missing/partial content approval must never expose draft questions.
- Account transition during a save must not capture another owner's answers.
- Crash between pilot save and answer capture must yield one durable truthful event after retry.
- Held-out answers must not leak keys/feedback or become invented retention/mastery evidence.
- Beta build must fail closed for missing origins/identity and never weaken normal release or private CA boundaries.

### Task 1: Beta and starter contract
**Files:** new app/src/config/privateBeta.ts, app/src/pilot/unitA/review.ts; new focused tests.
**Consumes:** validated SupabaseConfig and exact existing Unit A content.
**Produces:** validated beta capability and content-review decision usable by Home/route/controller.
- [x] Write/run failing tests for pending/stale/malformed/partial review, exact content binding, missing/unsafe origins, production mixing and disabled default.
- [x] Implement minimal pure decisions, keeping default review pending.
- [x] Verify new tests plus frozen baseline.

### Task 2: Reachable review-gated starter flow
**Files:** Home/navigation, Unit A route/controller/screen, new tests; use actual names after source inspection.
**Consumes:** Task1 decisions; existing learner/profile/consent.
**Produces:** bounded tester entry with pending-review state and real teaching/practice/assessment when a valid compiled approval exists.
- [x] Write/run regressions for direct link, pending review, fixture-approved flow, pause/back/restart and held-out UI protection.
- [x] Integrate without changing draft content status or legacy developer behavior.
- [x] Verify focused and full tests.

### Task 3: Durable account-bound answer capture
**Files:** new pilot answer adapter; controller/screen/account-store/journal integration as necessary; new tests.
**Consumes:** actual committed pilot answer history and active dataset owner; Store answer APIs and existing journal.
**Produces:** deterministic existing-schema answer records for real choices only, idempotently captured and journal-compatible. Controller state remains local.
- [x] Pin exact current backend envelope constraints and record mapping in tests.
- [x] Write/run crash-retry, duplicate, wrong-owner, guest/account transition, failure, assistance and reserved-answer regressions.
- [x] Implement bounded catch-up outside nested store writers; retain local progress on capture failure and show truthful state.
- [x] Verify replayed events match existing backend validator and do not confer unsupported cloud mastery.

### Task 4: Connected beta build preparation and review deliverable
**Files:** app/eas.json, app config/public env validation, release/beta presentation, beta docs and new tests.
**Consumes:** real staging origins and identities only when later supplied; no secrets in source.
**Produces:** explicit private-beta profile that fails closed until required values exist; reviewer packet for 2 lessons/20 MCQs.
- [x] Add tests for missing identities/origins and ordinary-release QA exclusion.
- [x] Prepare profile and safe concise beta presentation without enabling unapproved accounts/content.
- [x] Reuse validated reviewer packet; upload via supported Library workflow if available.
- [x] Full tests, typecheck/lint, protected-hash verification, independent review, JS exports and isolated rendered checks. No public push.

## Durable-capture design refinement after source review

The initial record capture must not call recordAnswer with a reread snapshot (that can rewind legacy progress), nor append outside a guarded writer (that can resurrect data after reset). Add an optional snapshot-preserving Store.appendAnswer(record, guard) implemented on real KvStore/SqlStore. The guard checks learner ID, exact committed pilot metadata and a live dataset binding inside the write queue, then immediately before commit. Do not fabricate timestamps for historical pilot choices: new opt-in capture intents are stored atomically with new first choices in the pilot document; old histories remain local. Drain outside nested store writers, retry on load/sync, deduplicate deterministic event IDs, reject conflicting duplicates, and report locally-saved/capture-pending honestly.

Freeze actual option order/text, selection, time and source provenance at first choice. Keep held-out outcomes pending/deferred without keyed score so ordinary progress summaries cannot leak a live block's correctness. Preserve source provenance and explicit unmeasured duration. Existing answer-envelope schema only; unknown source versions can be stored unregistered and must not be called registered mastery. Pilot scheduling/controller restoration remains device-local in this beta slice.

Captured pilot records must not contaminate legacy retention anchors or the pilot's own assistance checks. Exclude only strictly validated own pilot deferred records at those read boundaries; malformed/unrecognized records stay conservative. Propagate a synchronous verified-account/dataset liveness fence from AccountContext to AppContext/route, because native dataset release is a no-op. Protect reset/logout/account-switch races, storage failures, exact snapshot bytes and existing data through new regressions; no old tests/fixtures may be weakened.

## Local verification outcome

The source slice passes 1,939 tests (2 pre-existing SQLite-only skips), TypeScript and the repository Expo lint command (3 existing warnings). All 181 baseline test/helper files remain unchanged. Independent review reproduced and verified repairs for guest-copy retry, failed-reset recovery and late reset settlement. Web/iOS/Android JavaScript exports pass with explicit compile-only fixture configuration; the browser on the user Mac verifies pending-review Home, direct-link blocking and back navigation. The compiled review remains pending. A final export is stamped after the local commit; neither export is a signed native app or real backend acceptance. See docs/mobile/Private_Tester_Beta.md for remaining content, normal-email policy, hosting and signing gaps. No publication, email or account-access change was performed.
