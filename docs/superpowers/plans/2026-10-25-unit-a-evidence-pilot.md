# Unit A evidence pilot implementation plan

> For agentic workers: use the executing-plans and test-driven-development skills. Opus authors product changes in bounded slices; Codex coordinates verification and publication.

Coordinator checklist based on the user's approved milestone and the completed Opus audit. Product code, content and tests are authored by Claude Code Opus5.5 max. User opted out of further design questions. Reversible choices below are coordinator defaults, not validated pedagogy.

**Goal:** one reachable developer UnitA pilot with scaffolded four-choice practice, unfamiliar-combination assessment, delayed checks and explicitly provisional evidence eligibility.
**Architecture:** additive versioned pilot modules and route using the AppContext-selected Store. Separate versioned metadata preserves legacy v0.3 answers/snapshots/semantics. Pilot progress is local to that dataset; do not claim cloud sync/export coverage that is not implemented.
**Stack:** existing Expo57/RN0.86/TypeScript/Jest. No dependencies or stack rewrite.
**Spec:** docs/superpowers/specs/2026-10-25-unit-a-evidence-pilot-design.md; original tracked four-choice design and completed pedagogy audit. New content remains constructed, synthetic/draft and excluded in tester mode.

## Constraints
- Preserve all118 existing tests/legacy content files byte-for-byte. New regressions use new files, freeze after valid RED before implementation.
- Four choices with one correct key; no blanks, typed response, real Quran text, learning-efficacy/mastery claims or fake reviewer approval.
- No auth/credentials/services/account permissions, paid overages/fallback, existing Expo changes, merge or deployment.
- Existing PR5 is the sole authorized publication target after checks/review. No force push.
- All pilot data follows current Store ownership/read-only limits; no old session snapshot overwrite or guest/account mixing.

## Tasks
1. **Small pure evidence contract**, new app/src/pilot/unitA/evidence.ts and __tests__/evidence.test.ts. Export a simple explicit provisional eligibility function and version constants. Begin with three behavioral cases: varied correct practice+fresh later-day transfer can qualify; all wrong/dont-know attempts cannot; same-day transfer cannot. Then add duplicate/first-attempt, stale-version/future-date and missing-family cases in separate RED→freeze→GREEN slices. Record precise API and hypothesis in the ledger before consumers are built.
2. **Draft content and scaffold planner**, new content.ts/types.ts/planner.ts and new tests under pilot/unitA. Small worked example→fresh practice→mistake feedback steps for pronoun reference and adjective agreement. Versioned item/family identifiers; at least two practice families per construct and separate unfamiliar-combination transfer plus D7/D30 banks. Exact reserved assessment stems/solutions never appear in earlier learner UI/Guide/feedback. Validate four options/one key, harakat, draft provenance and no heldout leakage. Stable delayed anchor, no shifting from reviews/remediation. Incorrect/unknown responses yield useful practice/review or honest insufficient-evidence status; no invented success when the bank is exhausted.
3. **Durable controller and reachable UI**, new storage/controller modules with tests, route app/src/app/unit-a-pilot.tsx and focused UI component, minimal developer Home entry in index.tsx. Use selected Store metadata only; retain previous sessions and all existing account functions. Save-before-display progress; deterministic restart and option order; duplicate-submit protection; honest save-failure state; switch/readonly guards with no stale account content. Hide all draft pilot content and entry in tester mode. Visible short Indonesian explanations distinguish provisional eligibility, delayed results and validated mastery. Document local-only sync/export limits and human Arabic/Indonesian review checklist. XP stays deferred; any future XP should measure transparent workload/effort and must not substitute for evidence gates.

## Provisional hypothesis
For this engineering pilot, require correct first attempts on at least two distinct fresh practice families for each of the two constructs, plus a correct held-out unfamiliar-combination assessment for each construct on a later local calendar day. No same-day/assisted/reused/unknown-version or duplicate events count. This threshold is an explicit reversible hypothesis, not a learned/remembered verdict. D7/D30 checks remain separate descriptive evidence. Author may tighten the representation after actual interfaces are verified; ledger any ruling.

## Review risks and acceptance checks
1. Attempts/guess grinding: all-wrong, dont-know, duplicated IDs/families, first wrong→later correct and correlated/assisted events do not fabricate eligibility.
2. Leakage/timing: heldout task families absent from teaching/practice/distractors/feedback; same-day exposure postpones evidence; D7/D30 anchor remains stable across remediation and restart.
3. Persistence/errors: double tap, route leave/reload, interrupted save, malformed/newer metadata and version mismatch fail safely without deleting old history or claiming saved progress.
4. Isolation/gating: guest/accountA/accountB switch and readonly store cannot expose or write another dataset; tester direct navigation cannot render draft material.
5. Real UI: narrow320/390px and enlarged text, visible draft/provisional states, new entry→teaching→answer→feedback→next→progress; no runtime errors/overlays or answer-key leakage before submit.

## Verification and publication
- Per slice: Opus writes new tests only → coordinator validates RED and freezes hashes → Opus makes minimal implementation → targeted GREEN; do not weaken assertions.
- Full Jest baseline currently1117/114 PASS; final full Jest, typecheck, lint, frozen integrity and offline exports.
- Fresh independent Opus review of exact diff after author stops; fix Important/Critical findings with regression proof.
- Commit reviewed coherent work locally, export exact commit with isolated Metro TMPDIR, browser interaction/restart checks on user's Mac using synthetic local fixtures, screenshots and clear service/device proof limits.
- Verify unchanged source after final tests/build, commit/push only scoped paths to existing draft PR5, verify remote SHA and actual CI jobs/status. Zero jobs is not a pass. Keep pending human content review and efficacy limitations explicit.

## Core checkpoint status

Task1 pure evaluator is implemented with frozen regression coverage; final checkpoint verification is recorded externally. Its public interface is `canAdvanceUnitA(events: readonly PilotEvidence[]): boolean`; events carry id, construct, family, kind, outcome and local day. Storage/catalogue ownership/version/future-date validation remains upstream and is not yet implemented. Content, planner, controller and UI remain future tasks in this plan. No full learner-facing milestone or mastery claim is made by the core checkpoint.
