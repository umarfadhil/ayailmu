# Four-choice Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The existing Claude Code session is the single implementation writer; Codex performs independent review/QA. Steps use checkbox tracking. No remote push.

**Goal:** A local Unit A→basic Unit B→review loop with exactly four defensible answer options and durable, honest progress.

**Architecture:** Version the content/answer/snapshot semantics, preserve immutable legacy evidence, and derive reviews/progress from the durable log. Keep the existing store transactions, controller boundaries, Expo Router shell and Sottaku-based UI. Three dependent tasks form one bounded local slice.

**Tech Stack:** Expo SDK57 / React Native0.86 / TypeScript / Expo Router / SQLite(native) / localStorage(web) / Jest. No new product dependencies.

**Spec:** `../specs/2026-10-15-four-choice-learning-loop-design.md`, plus the unchanged three source documents it references.

## Global Constraints

- Exactly four answer choices, one correct, three defensible distractors; no learner typing or binary question fallback.
- All new content is synthetic/draft and inaccessible in tester mode.
- `review_spacing_days=[1,3,7]`, `review_share_max=0.5`; settings are provisional and versioned.
- Recognition never counts as typed/built; learned remains unassessed pending the product decision.
- Preserve all legacy answers, consent, settings, learner ID and reports; archive incompatible snapshots atomically.
- One implementation writer in canonical `app/`, local feature branch, ordinary safeguards, Opus5.5 High.
- No new backend/auth/paid services, no remote push or deployment. Keep QA artifacts outside committed source.

## Review Focus

- A migrated typed answer must not be re-graded by a new choice key; Task1 pins old raw strings and scores exactly.
- An unanswered reserved verb can leak through an Arabic distractor/example; Task1/2 test exposure-based form protection.
- Replayed duplicate events can advance schedules or rewind snapshots; Task1/2 test idempotent persistence/replay.
- Repeated daily reviews can move the practice anchor and prevent D7 forever; Task2 tests an unchanged anchor across reviews/checks.
- Tester mode with a populated legacy developer store can leak content through a direct route; Task3 checks every learner/content route.

---

### Task1: Versioned four-choice content, scoring and legacy-save safety

**Files:** `app/src/content/{schema,gating,load}.ts`, new active/legacy fixtures, `app/src/engine/{shuffle,scoring,freshness,controller,session}.ts`, `app/src/storage/{types,sqlStore,kvStore}.ts`, content/engine/storage tests, minimum four-choice `app/src/app/session.tsx` integration and routed flow tests, `docs/Four_Choice_Content_Review.md`.

**Interfaces:**
- `ChoiceOption`: stable ID/text/key, misconception metadata, seriousness and feedback; active item has four options, format and lineage.
- `optionOrder(ids: readonly string[], rng?: () => number): string[]`: injectable Fisher–Yates permutation; saved per step, never recomputed by render.
- AnswerRecord optional v2 fields: schema/evidence mode, lineage, source role, presented option IDs/text/positions, selected ID/position and misconception. Existing v1 fields remain unchanged.
- Store adds `getMeta(key)`, `setMeta(key,value)` and `archiveSnapshot(reason)`; archive and active-snapshot clearing are one atomic serialized operation. Unsupported future schemas are rejected.
- Session v2 item step carries `option_order`; restore validates the exact permutation and version/lineage. Scoring returns the actual misconception-specific tags/feedback; legacy scorer remains internal for history.

- [x] Write failing content/scoring/order tests with literal source-backed answer expectations, duplicate/overlap cases and invalid permutations. Observe expected failures before implementation.
- [x] Implement the active Unit A/B-basic synthetic four-choice pack, stable lineage, pure shuffle/scoring and validator. Exclude weak glossed bare verbs and unresolved transfer clashes. Audit every wrong option's rationale independently from its key flag.
- [x] Write failing parameterized store/controller tests for realistic v1 blobs/SQLite rows: exact raw history and scores, unchanged learner/settings/reports, atomic archive/restart notice, failed-write rollback, future-schema refusal and duplicate-event idempotency.
- [x] Implement the minimal safe migration/metadata and snapshot v2 behavior. No destructive reset; new snapshot saved before display.
- [x] Cut over the minimal exercise UI and its routed flow expectations to four-choice Unit A as part of this foundation. Keep basic Unit B activation for Task2; no temporary learner typing fallback.
- [x] Run content/scoring/controller/repository tests, then the full suite. Expected: all pass; old typed grading tests still pass as legacy semantics. Record RED→GREEN evidence and deviations in ignored implementation ledger. Do not commit yet; Codex commits the verified whole slice.

### Task2: Durable review scheduling, Unit order and factual progress

**Files:** new `app/src/engine/reviews.ts`, `progress.ts` and tests; modify `session.ts`, `freshness.ts`, config/rules and controller as needed.

**Interfaces:**
- `reviewStates(log,content,rules,today)` returns versioned per-key review level, last exposure, due date and provenance. `dueReviews(...)` chooses each due key once, ordered by due date and stable key.
- `progress(log,content,rules,today)` returns per-unit/skill/word practice and review facts, unresolved errors, check counts/coverage and evidence/config provenance; learned is unassessed.
- Session roles add `review` and `check`; review records are never first/fresh attempts. Reuse Task1 option permutations and lineage. Basic Unit B follows completed Unit A screens/core practice; learned-based advanced branches remain locked.

- [x] Write failing hand-derived date tests: first exposure Jan1→Jan2; correct Jan2→Jan5; correct Jan5→Jan12; wrong Jan12→Jan15; lower bound1day, upper bound7days, same-day suppression, overdue once, leap/year boundaries, legacy lineage and deterministic replay.
- [x] Implement pure review replay/selection from the durable log. Preserve provisional ladder and no mutable second schedule store.
- [x] Write failing planner tests for D7/D30→reviews→lesson order, ≤half planned review slots, item-boundary time allowance, no early/reserved-form exposure, READY/later-day constraints, no freshness from legacy/review, unchanged D7/D30 anchor after reviews/checks, serious-error FOCUS+fresh REMED, and Unit A→B-basic order.
- [x] Implement planner integration and conservative progress projections. Sparse checks remain explicitly partial; no invented mastery/retention/transfer threshold. Legacy pending stays neither correct nor wrong.
- [x] Run review/progress/session/freshness/controller tests and the full suite. Expected: deterministic due schedules and honest facts persist by replay after reopening either store. Record evidence/rulings; do not push or commit.

### Task3: Four-answer UI, progress surface and independent rendered validation

**Files:** `app/src/app/{session,index,summary,guide,progress,dev}.tsx`, `app/src/ui/{Nav,components,AppContext}.tsx`, routed UI tests and READMEs. Keep stable Stack parent structure.

**Interfaces:**
- Build on Task1 ItemView, which consumes only current mcq4 options in persisted order and submits a choice ID; four accessible answer tiles, no graded answer-input/ref-toggle path.
- Home/summary/guide consume current unit and durable due/progress projections; new Kemajuan route shows separate learner facts and unassessed mastery lines. Migration notice has an explicit preserved-history message.
- All content-bearing routes gate empty/tester mode even when legacy developer learner data exists. Consent/settings controls keep their existing non-exercise choices.

- [x] Write failing routed tests for four options throughout Unit A/Unit B/review/focus/remediation, no mandatory typing, correct key feedback, same saved order after retry/reload/resize, one event on double-submit, migration notice, factual progress and gated advanced items.
- [x] Implement the minimal UI using existing cream/navy/indigo tokens and native Arabic font; four tiles with clear tap targets and readable full text. Preserve report/settings persistence, responsive shell and read-only guide.
- [x] Run the full Jest suite, typecheck and lint. Expected: all pass with no hidden red suite. Update public documentation for exact new scope, recognition evidence, migration and deferred content; no personal paths or transcript/evidence files.
- [x] Tell Codex the source is stable for preview restart. Codex runs fresh-profile browser flows at mobile/desktop: Unit A→B-basic, next-day review, partial timed checks, legacy-save migration, wrong/don't-know/focus/remediation, quota error/retry, double taps, reload/order, resize, progress/settings/reporting and tester mode with old developer data. Capture actual screenshots outside the repository and compare to Sottaku references.
- [x] Fix confirmed behavioral defects through regression tests, then re-run affected checks and the full suite. Independent whole-branch review covers content keys/distractors, migration and review-date provenance. Final state must be green.
- [x] Codex reviews the final diff/secret exclusions and commits locally. Expected: clean feature branch with a ready commit; remote main remains `f6d76e9` until a separate push request.
