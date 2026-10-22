# Exact completion proof checkpoint — 20 October 2026

Three older ownership tests could finish before the operation they intended to verify: the activation test accepted an initial null, and two stale-failure tests could consume another request's exit signal without waiting for their ViewModel failure handler. This checkpoint starts from `fe6b0c0ed54f289749a0b93b37f8cfebbe1c89eb` and repairs those proofs while preserving the cancellation implementation.

`SyncLabRepository` retains its existing initialization job as an internal completion handle. The activation test parks A's requested store write, proves initialization is pending, then records applied writes after the delegate store returns. It observes A followed by its compensating clear, joins that exact initialization job, and checks B's authentication and whole non-null saved credentials afterwards. It cannot succeed merely because the active profile began null.

The fake backend registers each learner request's entry and terminal signal together before its gate. Its terminal signal covers the entire invocation, including cancellation at the gate. The stale-failure tests retain A1's exact pair, so B/A2's later exit cannot satisfy the old wait. They capture the actual `refresh` action job, prove it is pending at the held request, await that job's completion through its failure handler while driving Main, and only then assert the newer session and whole saved credentials remain intact. Gates and owned operations are released/completed in teardown.

This is a validation repair plus an initialization completion handle, not a new auth algorithm change. No new red regression is claimed. Published cancellation assertions and the original three cancellation test bodies are unchanged; the engine and account implementation are unchanged.

## Verification

- The three named repaired proofs passed: **3/3, 0 failures/errors/skips**, true Gradle exit 0, fresh XML.
- Independent `sh integration/run-e2e.sh`: **20/20, 0 failures/errors/skips**, real isolated GoTrue/API/Mailpit and actual issued-token expiry.
- Independent `sh integration/run-android-e2e.sh`: **58/58, 0 failures/errors/skips**: 55 account cases and three Room cases. Runners were sequential and removed generated token fixtures.
- `:app:assembleSyncLabDebug`: passed. The following hashes matched throughout independent verification:

| File | SHA-256 |
| --- | --- |
| `SyncLabAccount.kt` | `3a9355149562f1fbfe12799daba7ac320b5cccddb5904db954beaae2a3fab460` |
| `SyncLabRepository.kt` | `389d8c83c496d460c36247d6aea488e2b52c1d27deb4fab7c1307f4d06e21f0d` |
| `SyncEngine.kt` | `4519a5b5094cf3fdd779c60c7c5c77ed0d7a9cb14c2dce7ab2d486bac193c9f8` |
| `SyncLabAccountTest.kt` | `0c41806547542053a3e2020fa7f4a32ee15e53ab1d405d14012e68bf7951fb40` |

Kimi Code CLI 2.2.0 was the sole latest implementation/test author, using the same native session and manual allow-once approvals. All 105 recorded requests across the session (29 in this step) used `kimi-for-coding`, alias `kimi-code/kimi-for-coding`, effort `max`; catalog metadata and the [official mapping](https://www.kimi.com/code/docs/en/kimi-code/models.html) identify K2.8 Preview without exposing an immutable provider snapshot. The third native turn completed normally and stayed idle while Codex reviewed, independently verified, documented and handled Git transport. No fallback or second writer was used.

## Remaining scope and release gates

Actual current-navigation-entry ownership of auth callbacks remains open: an outgoing route can stay composed after Back/replacement. This is the remaining task in the [follow-up plan](../superpowers/plans/2026-10-20-umar-account-race-followup.md).

The preceding exact-head [CI run on fe6b0c0](https://github.com/umarfadhil/ayailmu/actions/runs/39401325625) failed the gallery screen-state `StoryTest` method: 293 tests, one failure, at line 551. Earlier/main runs failed the same method at line 549; these are different assertion locations. Story/figure source is unchanged from main. Pure Kotlin/pack validation passed; demo tests failed before confirmed lint/demo assembly, and ktlint was skipped. A new head requires its own CI result, tracked in the draft PR. No green full demo/lint claim is made.

Go/backend source and native learning algorithms are unchanged. Earlier Go race/Postgres evidence remains historical. Real learner collection and live Google remain unsupported/unconfigured release work; no real accounts or credentials, Amar resources or older worktrees/volumes were changed. No merge or deployment. [Cancellation checkpoint](2026-10-20-cancellation-cleanup-checkpoint.md) · [Local launch](../../integration/README.md) · [Backend architecture](../../backend-umar/docs/architecture.md).
