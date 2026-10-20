# Cancellation ownership checkpoint — 20 October 2026

Cancelling sign-in, confirmation or simulated Google completion after engine authentication committed but before vault installation could leave busy/live authentication and a durable owner behind. This checkpoint starts from `b78ff394a36c1724d1c2c327977cc921bbda68dc` and preserves the publication and learning fences.

The engine now records a session-generation receipt inside its actual commit lock. Cancellation cleanup uses that receipt to clear only the still-matching engine session, with the comparison and mutation under the same lock. Recording a mark after login returned would have allowed a newer same-owner refresh to be mistaken for the cancelled attempt.

The account performs local cleanup under `NonCancellable` and then propagates cancellation. It resets busy only while its account attempt remains current and does not clear vault material it never installed. The repository checks ownership across local storage cleanup and carries its explicit operation fence through the final publication after any waits, including signed-out publications without an origin owner. Profile rows, answer history and per-owner queues are retained. Cancelling a prepared Google intent also removes the newly introduced owner without erasing genuine prior credentials.

## Deterministic evidence and independent checks

The three independently runnable credential-flow regressions park the exact learner-load request after engine commit and before vault installation, then cancel and join that exact coroutine. Against unchanged old logic, all three failed the intended busy-cleanup assertion: **3 failures, 0 errors/skips**. The same test source then passed **3/3**. Their individual test bodies remained identical through the final checkpoint.

Five additional preservation controls hold old cleanup before the local ordering boundary while B, same-owner A2, or a refresh at the same account nonce fully installs newer credentials. They compare whole non-null `SavedAuth` snapshots, selection/profile state and a usable live session after the old job joins. A storage-wait control proves cleanup stays pending until its active-store clear completes; an unbound newer B finishes with a nonempty remote learner list whose credentials, notice and list survive. A fake-only Google control retains valid provider-issued vault material that the cancelled attempt never installed. The older Google control now waits a fresh request and proves the new owner/live auth exists before cancelling, avoiding setup milestones and initial-null assertions.

- Final focused run: **15/15 passed, 0 failures/errors/skips**: original three, five new preservation controls and seven existing Google/install/logout controls. Only the original three assertion failures are claimed as red regression evidence.
- `sh integration/run-e2e.sh`: **20/20 passed, 0 failures/errors/skips**, with real isolated GoTrue/API/Mailpit, including actual token expiry.
- `sh integration/run-android-e2e.sh`: **58/58 passed, 0 failures/errors/skips**: 55 account cases and three Room integration cases, with real local services. The runners were sequential and removed their generated token fixtures.
- `:app:assembleSyncLabDebug`: passed. The following product/test hashes matched throughout independent verification:

| File | SHA-256 |
| --- | --- |
| `SyncLabAccount.kt` | `3a9355149562f1fbfe12799daba7ac320b5cccddb5904db954beaae2a3fab460` |
| `SyncLabRepository.kt` | `5d1e7f84d0c4779c8047634b0ed92eaa91a6b13536d74d2a7902852ad6b322fb` |
| `SyncEngine.kt` | `4519a5b5094cf3fdd779c60c7c5c77ed0d7a9cb14c2dce7ab2d486bac193c9f8` |
| `SyncLabAccountTest.kt` | `457d864483b4c1b0d15746d1af8c07281d4a11e5a83c31c6f1fb257dcccd9861` |

Kimi Code CLI 2.2.0 was the sole author of this implementation and its tests. All 76 native requests recorded `kimi-for-coding`, alias `kimi-code/kimi-for-coding`, effort `max`; native catalog metadata and the [official mapping](https://www.kimi.com/code/docs/en/kimi-code/models.html) identify K2.8 Preview. No immutable provider snapshot is exposed. Manual allow-once approvals were used without a broad permission grant. Both native turns completed normally, and the same CLI remained idle while Codex reviewed, independently verified, documented and handled Git transport. No implementation fallback or second writer was used.

## Remaining scope and release gates

Older activation/failure-handler tests still need exact compensation/handler completion proofs, and auth-route callbacks still need actual current-navigation-entry ownership during transitions. Those remain open in the [follow-up plan](../superpowers/plans/2026-10-20-umar-account-race-followup.md); this cancellation checkpoint does not close them.

Go/backend source is unchanged; earlier race/Postgres results are historical, not a fresh run here. Only syncLab was assembled. The preceding exact-head [CI run on b78ff39](https://github.com/umarfadhil/ayailmu/actions/runs/39389275390) failed the same `StoryTest` method at line 549 as verified main `815e30f`: 293 tests, one failure. Demo lint/assembly were not reached and ktlint was skipped. The new head requires its own CI result, tracked in the draft PR; no green full demo/lint/ktlint claim is made here.

The ordinary app's native graph, consent/mastery algorithms and manual upload boundaries are unchanged. Real learner collection remains unsupported and live Google remains unconfigured release work. No real accounts, provider credentials, Amar services or older worktrees/volumes were changed. No merge or deployment occurred. [Local launch](../../integration/README.md) · [Backend architecture/schema/API](../../backend-umar/docs/architecture.md).
