# Umar Account Race Follow-up Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, with Kimi Code CLI as the sole source/test author, one task at a time. The user resumed native Kimi K2.8/max generation on 20 October; execute one defect at a time.

**Goal:** Close the remaining account/publication races with deterministic evidence.

**Architecture:** Carry each operation's owner, learner and session-attempt identity across suspension and through its final mutation/callback. Cleanup must be cancellation-safe and affect only its own attempt. Keep the existing native graph and algorithms.

**Tech Stack:** Kotlin coroutines, Room/Robolectric, existing GoTrue/API fakes and isolated real-service runners.

**Spec:** [Current checkpoint](../../integration/2026-10-20-k3-notice-checkpoint.md), [Important findings](../../integration/2026-10-19-wip-checkpoint.md). Starting SHA: `6a12fcaefca30962e8042c2c7afdd17237b60169`.

## Global Constraints

- Sole implementation writer: Kimi Code CLI, **K2.8 Preview** per the latest user instruction: actual `kimi-for-coding` / alias `kimi-code/kimi-for-coding`, thinking `max`; verify the request metadata before proceeding, with no fallback or parallel writer. Earlier K3 checkpoints remain historical evidence only.
- Generation is authorized by the resumed task instruction. No merge, deployment, OAuth/credential changes or real learner data.
- Give Kimi one defect and a small verbatim excerpt bundle; use bounded lookups, not whole-file reloads.
- Read live quota first and choose an explicit affordable wall/capacity budget, including follow-up work after an edit. Stop transparently on that budget without automatic retries. Usage may settle only when a call completes or is cancelled, so a ratio limit is not a guaranteed billing cap.
- **20 October tooling correction:** retire the previous 90-second no-tool timer. A max-thinking request can be reasoning without a new tool call; absent progress telemetry is uncertainty, not proof of failure. Use the maintained native CLI with manual, allow-once tool approvals and audit canonical request/tool IDs. Classify explicit wall/capacity budget stops separately from failures. The local ACP monitor/client is an experimental offline-tested prototype: it still rejects live permission metadata and must not be used for app execution or treated as verified K2.8 automation.
- Preserve tests/source/history and capture true command exits. A compiler error is not the required red regression.

## File Map and Review Focus

All lab paths below are under `android/app/src/`:

- **R:** `syncLab/java/id/petalytix/ayailmu/feature/synclab/SyncLabRepository.kt` — ordering, readiness, final publication.
- **A:** `syncLab/java/id/petalytix/ayailmu/feature/synclab/SyncLabAccount.kt` — attempt identity, credential installation and cleanup.
- **V:** `syncLab/java/id/petalytix/ayailmu/feature/synclab/SyncLabApp.kt` — ViewModel action completion/navigation; use only the ViewModel slice.
- **T:** `testSyncLab/java/id/petalytix/ayailmu/feature/synclab/SyncLabAccountTest.kt` — fakes/harness and targeted race tests; use slices only.
- **E, read-only initially:** `android/core/sync/src/main/kotlin/id/petalytix/ayailmu/core/sync/SyncEngine.kt` — `login`, `logout`, `expireSession`, `sessionMark` contracts.

Pin these cases to their owning task: publication lock wait (1); same-owner replacement (1–3); cancelled cleanup suspended in storage (3); cancelled signed-out Google preparation retaining an owner (3, simulated only); old handler/compensation finishing after a newer operation (2,4).

## Task 1: Finish the publication fence

**Small input:** R `finishLogin`, `ownerCurrent`, `publish`; T fake/harness slices, the new stale-sign-in test and the current-account 503 test. No A/V or whole T initially.

**Existing interfaces:** `finishLogin(owner: String, accepted: () -> Boolean)`; `publish(message: Int? = null)`; `sessionMark(): Long`.

- [x] Add a failing `staleLearnerNoticeCannotPublishAfterPublicationWait` regression: queue A's failure publication after its pre-check behind a held publication boundary, start B until engine ownership changes, then release the boundary and await both exact jobs. Do not await B's entire sign-in while holding the publication mutex: B also needs it. Collect each publication deterministically, so B's later success cannot hide an intermediate A-error notice labelled as B. Assert no such emission and B's final authenticated owner/vault remain correct. Use one narrow gate/seam if needed; no sleeps or initial-state polling.
- [x] Add the A1→A2 same-owner variant; owner equality alone must not accept A1.
- [x] Kimi makes the minimal source change carrying origin acceptance through the final publication mutation, including its suspensions, and corrects the overstated comment.
- [x] Run the new cases plus the existing stale-load and current-account 503 tests. A current 503 must still publish its failure notice. Require red/green, review, then a checkpoint.

## Task 2: Fence learning readiness and the actual callback

**Small input:** R `prepareLearning`, `activateLocally`, `selectionCurrent`; V `action`, `exclusive`, `learn`; T harness and existing failed-activation tests. E session identity is reference only.

**Existing interfaces:** `prepareLearning(): LearningReadiness`; `learn(ready: (LearningReadiness) -> Unit)`.

- [x] Add `learningReadinessRejectsOwnerChangeDuringConsentRead`: activate A, park the exact profile/consent read after local activation, sign in unbound B, release/read completion, await the exact learning job; expect `NOT_READY`, no route callback for A and no active A profile.
- [x] Add `learningCallbackRejectsSessionChangeBeforeMainDispatch`: let readiness finish on IO but hold Main dispatch, change to B or A2, then dispatch the pending completion; assert no stale success callback after the exact action completes.
- [x] Kimi fences both boundaries without replacing native consent/mastery behavior. Positive controls: unchanged valid A navigates exactly once; current consent-needed state remains accurate.
- [x] Run those red/green cases and current activation tests; review/checkpoint this defect separately.

## Task 3: Clean up the cancelled authentication attempt

**Verified:** [Cancellation checkpoint](../../integration/2026-10-20-cancellation-cleanup-checkpoint.md).

**Small input:** A `begin`, `install`, `signIn`, `confirm`, `completeGoogle`, cleanup helpers; R `login`, `finishLogin`, `logout`, `expireSession`; T learner gate, vault/harness and simulated Google-cancel tests. E authentication/session methods are reference only.

- [x] Add `cancelledCommittedCredentialAttemptCleansOnlyItself`, with sign-in/confirmation/simulated-Google variants. Starting signed out with an empty vault, park each flow after engine authentication commits but before vault installation; cancel its exact coroutine and `cancelAndJoin` it. After cleanup completion, assert busy is false, no live unpersisted authentication/vault and no selected owner/profile.
- [x] Repeat while B or same-owner A2 finishes before old cleanup is released; snapshot the newer vault and selection, join old cleanup, then assert they are unchanged and usable.
- [x] Exercise cancellation while cleanup's local storage boundary is suspended. A simulated abandoned Google attempt must not erase genuine credentials it did not install or retain a new owner. No live Google configuration or calls.
- [x] Kimi implements attempt-specific cancellation-safe cleanup; it must not depend on `committed` becoming true only after the suspending learner load returns.
- [x] Run these red/green cases and existing installation/storage/logout controls; review/checkpoint separately.

## Task 4: Repair older completion proofs

**Verified:** [Completion proof checkpoint](../../integration/2026-10-20-completion-proof-checkpoint.md).

**Small input:** T fake milestones and only `lateActivationCannotOwnCurrentSession`, `staleOrdinaryActionFailureDoesNotExpireNewerSession`, `staleFailureCannotExpireReinstalledSameOwnerSession`; V/R signatures only if a minimal completion seam is necessary.

- [x] Pair entry/exit signals with the exact gated request; B/A2's learner call must not satisfy A's wait.
- [x] In late activation, observe A's write and its later compensating clear, then await that activation's completion; initial null is not completion.
- [x] Await the ViewModel action/failure handler itself, beyond HTTP exit, before asserting owner, authentication, vault and profile stability. Prove the test stays pending until that milestone is released.
- [x] Kimi authors only necessary test/seam changes. Run the repaired cases and full focused suite; review/checkpoint.

## Task 5: Use current-route ownership during transitions (Minor)

**Small input:** V `visibleOrigins`, `completeOn`, `rememberAuthOrigin` and auth composable callbacks; T disposed/kept-route tests. No R/A changes initially.

- [ ] Add `nonCurrentComposedRouteDoesNotNavigateOnAuthCompletion`: delay sign-in/signup completion, press Back to change the current navigation entry while the outgoing auth route remains composed for its transition, then await the exact completion. Authentication may install, but the old route must not navigate.
- [ ] Kimi binds completion to the current entry at the actual callback, rather than composition membership alone. Exercise both pop and replacement, plus a positive current-entry callback exactly once. Use the existing test setup and a narrow navigation-ownership seam if necessary; no new broad UI framework.
- [ ] Run the route red/green cases, preserve existing disposed/kept-route controls and review the NavHost adapter. Checkpoint separately from the Important repairs.

## Verification and Handoff

For each defect, first run only its named test(s) with `:app:testSyncLabDebugUnitTest --tests '*SyncLabAccountTest.<name>' --rerun`. Then run the full account/Room classes and required flavor assembly on a frozen source snapshot. Use JDK 17 and the existing task-local Gradle/SDK configuration.

Before an authorized publication checkpoint, stop the writer and run `sh integration/run-e2e.sh`, then `sh integration/run-android-e2e.sh` sequentially; require zero failures/errors/skips and fixture removal. Review the exact diff, normal-push only when already authorized, verify local/remote/PR SHAs, and inspect actual CI. Keep the baseline StoryTest failure and unreached lint results distinct from repair acceptance.
