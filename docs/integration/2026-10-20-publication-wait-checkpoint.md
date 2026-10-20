# Publication-wait checkpoint — 20 October 2026

An old sign-in's learner-load error could pass its owner/attempt check, wait inside publication, then attach its failure notice to a newer account. The preceding `6a12fca` checkpoint only rejected failures that were already superseded before calling `publish`.

The failure publication now carries its originating owner and acceptance predicate into `publish`. It revalidates them immediately before the state mutation, after the publication lock and content-loading suspensions. Current-account recoverable 503 notices still work. The native graph, mastery algorithms, backend contracts and ordinary application flavors are unchanged.

## Regression and independent verification

Two synthetic regressions coordinate a replacement after A's pre-check and before its publication captures account state: A→B and A1→A2 for the same owner. Each waits for both exact sign-in jobs. Under the publication lock, the next publication inspects the previous committed state, so a later successful publication cannot hide the stale error. Test scopes are cleaned up in `finally`.

- Before the behavioral fix: **2 tests, 2 intended stale-state assertion failures, 0 errors/skips**. The test source was unchanged after this red run.
- Independent targeted run after the final fix: **4 passed, 0 failures/errors/skips**, including the earlier already-superseded failure and current-account 503 recovery controls.
- `sh integration/run-e2e.sh`: **20 passed, 0 failures/errors/skips**, using the isolated real local GoTrue/API/Mailpit services.
- `sh integration/run-android-e2e.sh`: **43 passed, 0 failures/errors/skips**, including account/Room integration. The runners were sequential and removed their generated token fixture.
- `:app:assembleSyncLabDebug`: passed. Product/test hashes remained frozen across these checks:

  | File | SHA-256 |
  | --- | --- |
  | `SyncLabRepository.kt` | `20b4cfbbd077c3239829e9b4d61609165d23cc08e118c79bfb695852fd024392` |
  | `SyncLabAccountTest.kt` | `3385b53103e79f515a9ba6f6d8d929cf2683a3104772c1c99d6c816a32d9a06f` |

Go/backend source did not change; earlier backend race/Postgres validation remains historical evidence, not a fresh run for this app-only checkpoint. Demo/prod assemblies were not repeated here. The preceding exact-head CI run and main both failed the same pre-existing `StoryTest` assertion; see the [preceding checkpoint](2026-10-20-k3-notice-checkpoint.md). This checkpoint makes no new full demo/lint claim.

## Authoring and remaining work

Kimi Code CLI 2.2.0 was the sole implementation/test author, using the native manual workflow with one-time Bash approvals and no new session-wide grant. Live requests recorded `kimi-for-coding`, alias `kimi-code/kimi-for-coding`, effort `max`. The supported native model metadata and [official current model mapping](https://www.kimi.com/code/docs/en/kimi-code/models.html) identify this ID as K2.8 Preview; no immutable backend snapshot is exposed. Codex reviewed the patch, ran independent verification, documented evidence and handled Git transport. The writer completed normally before independent tests; no implementation fallback was used.

This closes the learner-load failure publication-wait schedule. Learning readiness and its final navigation callback, cancelled authentication cleanup, older compensation/handler completion proofs, and auth-route transition ownership remain open in the [follow-up plan](../superpowers/plans/2026-10-20-umar-account-race-followup.md). No real learner collection, live Google OAuth configuration, merge or deployment occurred. Existing policy/consent and production release gates remain unchanged.

[Local launch](../../integration/README.md) · [Backend architecture/schema/API](../../backend-umar/docs/architecture.md)
