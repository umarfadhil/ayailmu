# Current-entry auth callback checkpoint — 20 October 2026

An outgoing auth destination can remain composed during its pop/replacement transition after another navigation entry becomes current. Composition membership alone allowed its delayed successful completion to navigate again. Starting from `a1d1f8ada6d01f1ec1941073d1aec5d8f79690f2`, this checkpoint binds callbacks to the actual current entry while preserving successful authentication installation.

All five auth destinations pass their actual `NavBackStackEntry` to the composition/disposal registration helper. At completion, the ViewModel requires that origin to remain registered and be identical to the entry read directly from `nav.currentBackStackEntry`. The reader is evaluated at the callback, rather than capturing an asynchronously updated entry. An installed reader returning null suppresses navigation. Only tests without a navigation adapter retain the older composition-only compatibility behavior.

This does not cancel initiated authentication when navigation changes. The delayed sign-in tests await the exact action job and verify valid credentials and authenticated repository state survive even when its old navigation callback is suppressed. No account, repository, engine, consent or mastery implementation changed.

## Regression evidence

The compiling red used the old composition-only completion behavior with a reader seam. Three focused cases produced **two intended navigation assertion failures and one positive pass**, true Gradle exit 1, zero errors/skips:

- Delayed sign-in after a pop: the origin stays registered while a different entry becomes current; old behavior navigates once instead of zero times.
- Delayed signup after replacement: the same stale callback redirects once instead of zero times.
- An unchanged current origin navigates exactly once.

The stable reader is installed before starting authentication; the test changes the entry identity while the exact request is held. Both negative cases await the actual action job before checking callbacks. The same three test bodies are identical in red and green, verified against the archived red file hash. A fourth control covers an installed reader returning null and preserves the completed sign-in credentials.

The green run passed **7/7**, true exit 0, zero failures/errors/skips: these four cases plus all three existing disposed/kept-route controls. All previously published test source, including cancellation and exact-completion proofs, is unchanged.

These are deterministic JVM ownership tests and a review of the actual five NavHost adapters. They do not claim an instrumented device test of animated navigation transitions.

## Independent verification

The native writer completed normally and remained idle while Codex verified a frozen product/test snapshot:

- `sh integration/run-e2e.sh`: **20/20**, zero failures/errors/skips, isolated real GoTrue/API/Mailpit and actual issued-token expiry; fresh XML and generated token fixture removal verified.
- `sh integration/run-android-e2e.sh`: **62/62**, zero failures/errors/skips: 59 account cases and three Room cases. Fresh XML and `BUILD SUCCESSFUL` confirm the completed run; generated token fixtures were removed. The outer runner's PTY handle expired across the status handoff, so its numeric exit was not retained. The successful reports and log were archived without repeating the completed suite.
- `:app:assembleSyncLabDebug`: passed, true exit 0. All five frozen product/test hashes matched after the sequential runs and assembly.

| Changed file | SHA-256 |
| --- | --- |
| `SyncLabApp.kt` | `5c0a3dd396604b20ca96ea3c8f75ad234f131ed70c2afa2672da92431ae3b1b6` |
| `SyncLabAccountTest.kt` | `60c4aede4592e8353b403a3a0357706262fcf8b77f438e60e2aead6a9906bb8e` |

The account, repository and engine hashes match the [completion proof checkpoint](2026-10-20-completion-proof-checkpoint.md). Kimi Code CLI 2.2.0 was the sole source/test author, with native manual allow-once approvals. All **146** recorded requests in the persisted session used `kimi-for-coding`, alias `kimi-code/kimi-for-coding`, effort `max`; catalog and [official mapping](https://www.kimi.com/code/docs/en/kimi-code/models.html) identify K2.8 Preview without exposing an immutable provider snapshot. After an earlier runtime ended, the same canonical persisted session was resumed with an explicit model override before the route edits; there was no concurrent writer, login/config migration or fallback. Its final prompt completed normally. Codex reviewed, ran independent checks, documented and handled Git transport.

## Plan outcome and remaining limits

The five [account race follow-up tasks](../superpowers/plans/2026-10-20-umar-account-race-followup.md) now have their scoped repair/proof evidence. This closes the remaining composed-but-non-current callback finding; it does not claim that every possible application race has been proved absent.

The preceding exact-head [CI run on a1d1f8a](https://github.com/umarfadhil/ayailmu/actions/runs/39405153189) failed the gallery screen-state `StoryTest` method: **293 tests, one failure, line 551**, matching fe6b0c0's method/assertion. Main/earlier runs failed that method at line 549, a different assertion. Story/figure source remains unchanged from main. A new head requires its own CI result, tracked in the draft PR; no green full demo/lint claim is made here.

This remains an isolated synthetic-only lab. Real learner collection, policy/guardian consent and age eligibility, retention/export/deletion, live Google and production operations remain release work. The ordinary on-device learning graph and algorithms, Amar resources and older worktrees/volumes are preserved. Go/backend source is unchanged and earlier Go race/Postgres results remain historical. No merge or deployment.

[Local launch](../../integration/README.md) · [Backend architecture/schema/API](../../backend-umar/docs/architecture.md) · [Cancellation checkpoint](2026-10-20-cancellation-cleanup-checkpoint.md) · [Learning checkpoint](2026-10-20-learning-fence-checkpoint.md).
