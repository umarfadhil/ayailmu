# GoTrue Android account connection — verification

> **Current status: WIP.** See [the final checkpoint](2026-10-19-wip-checkpoint.md)
> for fresh K3/max verification, the quota interruption and unresolved Important
> findings. The repair-round narrative and earlier counts below are historical;
> they do not establish that every session-boundary defect is closed. The user
> subsequently authorized checkpoint push and an explicitly incomplete draft PR.

Verified on 19 October 2026 by the Kimi Code CLI writer (K2.8 Preview, max
thinking), sole implementation/test writer for this checkpoint. Branch
`feature/umar-native-integration-20261019`, local only. Base checkpoints:
published `3b4f2064103fe6514c314b9e9b60adcf6c9479ff`, GoTrue slice `90ccf1f`,
account slice `99b2387`. **No push, no PR, no deployment.**

## Review rounds closed

**Round 1** (`.runtime/umar-integration/kimi-readonly-review-notes.md`): ten
findings on the unfinished draft — synthetic-domain gate before any network
call; generation fences on credential writes/clears/UI publishes and native
profile activation; immediate local logout despite in-flight refresh and
storage failure; runtime refresh/reauth actions; account busy merged into the
UI; Google callback validation by generation/state/replay/expiry/clock
rollback. Each was reproduced failing, then fixed.

**Round 2** (independent read-only review of `90ccf1f..99b2387` plus
`.runtime/umar-integration/kimi-second-review-candidates.md`): six confirmed
findings, all reproduced with controlled gates (no network-timeout escapes)
and fixed in this checkpoint:

1. *Old logout erased a newer session.* `signOut` discarded its generation and
   unconditionally cleared the vault/published after the suspending local
   cleanup. Now logout's credential clear and UI publish are atomic with the
   generation (`synchronized` check-and-act, no network under the lock), the
   repository cleanup runs under a local ordering boundary, and the schedule
   is regression-tested with a gated active-profile store
   (`oldLogoutCannotClearNewerSession`).
2. *Journal/active-store failures skipped credential cleanup, and a failed
   sign-in vault installation left a live session behind `false`.* Cleanup is
   now independent per component (`logoutCleansUpIndependentlyWhenActiveStoreFails`),
   and failed installs expire the session and fail closed
   (`signInVaultInstallFailureLeavesNoLiveSession`).
3. *Startup/init activated a stale binding after logout.* All native
   activation (startup, login/select/prepareLearning) and cleanup route
   through one local ordering boundary that re-verifies the durable
   owner/binding after acquisition and never holds across network
   (`initActivationIsOrderedWithLogout`).
4. *Transient API 5xx cleared usable credentials and stale failures
   republished over newer accounts.* Clearing is now limited to conclusively
   invalid auth (provider 400/401, backend 401, subject/owner mismatch);
   5xx/offline preserve the session for retry
   (`transientApiFailurePreservesCredentialsForRetry`,
   `staleTransientFailureDoesNotDisturbNewerAccount`).
5. *Superseded signup/resend/recover/reset published success and could
   navigate over a newer flow.* Success, failure and UI publication are now
   fenced by the originating generation; superseded operations return `false`
   silently (`staleSignupSuccessDoesNotPublishOrReturnSuccess`,
   `staleResetDoesNotAffectNewerSession`).
6. *Cancelling Google mid-exchange could not invalidate the in-flight PKCE
   exchange.* Each Google intent carries an attempt counter bumped by
   cancel/replacement/account change; a stale exchange result is discarded
   before installation (`cancelGoogleInvalidatesInFlightExchange`).

Also fixed: the ViewModel lost its generic busy guard (repository mutations
now coordinate through a try-lock; logout and auth stay outside so logout can
still cancel a refresh); `failedRestoreCannotClearANewerSession` previously
made progress only via the HTTP client's 5s read timeout — it is rewritten
with explicit milestones, the release happens only after the newer session is
installed, and a real-time failsafe below the client timeout asserts no
timeout supplied progress.

**Independent verification failure at `99b2387`** (coordinator rerun,
`coordinator-android-verification.log`): `realGoTrue...OwnerIsolation` failed
at the empty-learners assertion after B sign-in. Root cause: cross-test
fixture contamination — `NativeRoomSyncTest` runs first and creates a learner
on shared fixture account B, so B's remote namespace was not empty. Fixed by
giving the account test its own freshly fabricated owner C (signup +
Mailpit confirmation inside the test) and strengthening the isolation
assertions: C's learners are empty, selecting A's learner is rejected, and a
direct API pull of A's learner with C's token returns 404. The test no
longer depends on fixture B at all, so the suite is repeatable in any method
order. Fixture files remain private/synthetic (chmod 600, deleted after
runs, nothing printed).

**Round 3** (`.runtime/umar-integration/kimi-review-round3.md`, review of the repair
draft; four Important findings, each reproduced at its later suspension
boundary with controlled gates — no network-timeout escapes):

1. *Failure cleanup could expire/erase a newer session.* The sign-in/confirm
   cleanup now expires the in-memory session **only when that operation
   actually committed a login**, clears the vault with the
   generation-atomic check-and-act helper, and carries the operation fence
   into `repository.expireSession`'s mutation after IO dispatch.
   `repository.failed` no longer expires anything (engine paths already
   fence their own sessions). Tests: `oldFailureCleanupKeepsNewerInstalledSession`
   and `failedSignInThatCommittedNothingKeepsNewerInstalledSession` park the
   old cleanup inside its vault clear while the newer account installs.
2. *Native activation raced owner B with no binding.* `activateLocally` now
   re-verifies the durable owner/binding **after** the suspending
   active-store write, undoes a stale activation before releasing the local
   boundary, and fails closed (no observation, no success) when the
   active-profile store throws. Tests: `lateActivationCannotOwnCurrentSession`
   (B signs in with no binding while A's activation is parked inside the
   store write), `failedActiveStoreFailsLearningClosed`.
3. *Google cancellation during the backend learner load still installed.*
   `completeGoogle` now keeps the combined account-generation + Google-attempt
   fence through the learner load and the atomic installation; cancelling or
   replacing the intent after the exchange discards the result and expires
   the half-committed session without touching a previous genuine vault
   session. Test: `googleCancelDuringLearnerLoadDiscardsSession`.
4. *System Back / route disposal left navigation callbacks alive.* Auth
   completion callbacks are now bound to the originating route instance via
   `rememberAuthOrigin` (DisposableEffect) and the ViewModel navigates only
   while that instance is composed; a completed sign-in still installs its
   session even when its route was disposed. Tests:
   `disposedRouteDoesNotNavigateOnDelayedSignup`,
   `keptRouteNavigatesOnCompletion`,
   `disposedRouteDoesNotNavigateButInstalledSessionSurvives`. Full NavHost
   instrumentation was not run (no Hilt test seam in this project); the
   regression exercises the same ViewModel seam the composables call, with
   the composable wiring in place for the coordinator's emulator pass.

**Round 4** (`.runtime/umar-integration/kimi-review-round4.md`, review during the
round-3 repair; three Important caller-level findings, each fixed with an
actual-caller regression):

1. *A failed activation still navigated into native learning under a previous
   profile.* `prepareLearning` now returns a tri-state `LearningReadiness`
   (READY / CONSENT_NEEDED / NOT_READY); `NOT_READY` (failed local
   activation, no binding) never navigates, and the hub only opens
   Consent/Session for the matching states. Test:
   `failedActivationYieldsNotReadyAndNeverOpensLearning` keeps A active while
   B's activation fails and proves the ViewModel reports NOT_READY — never a
   false "consent granted" — with no navigation.
2. *Google cancellation cleanup was not scoped to the attempt's own effects.*
   `completeGoogle` now passes the combined account-generation + exact
   Google-attempt fence through `repository.login` (backend commit and
   native activation included), and the catch only drops effects the attempt
   actually installed: a cancel before `repository.login` expires nothing,
   the vault is never cleared, and a cancel during the learner load leaves
   the durable owner/selection matched to the preserved older vault (a
   restore then recovers the genuine session). Tests:
   `googleCancelWithExistingSessionPreservesIt`,
   `googleCancelDuringLoadWithSelectedProfilePreservesSelection`, plus the
   round-3 learner-load discard test. Live Google stays disabled and
   unconfigured.
3. *A late ordinary-action failure could still expire a newer account.* The
   ViewModel binds every action's failure handling to the originating
   session (owner/authenticated captured at start); `repository.failed`
   keeps its 401-expiry but only behind the fence and never publishes when
   superseded. Test: `staleOrdinaryActionFailureDoesNotExpireNewerSession`
   gates "Load this account's learners", logs out, signs in B, then releases
   the old request with a 401 using a fresh per-request entered milestone
   (the harness now records every learners() call's entered/exit deferreds).

Test-harness repairs from the same review: the atomic-clear tests now
serialize B behind the clear and release before asserting survival (the
previously impossible "B finishes while A holds the atomic-clear lock"
schedule was removed), and the ViewModel route tests pump Robolectric's
main looper (`Shadows.idle()`) with cooperative timeouts instead of the
stalled `Thread.sleep` poll. The durable-invariant assertions (empty new
owner, cross-owner 404, exact-byte/offline isolation) are unchanged.

Two calibrated Minor boundaries remain documented, not blocking: departing
route composition is not current-entry visibility during transition
animations, and B-with-no-binding now joins an in-progress local activation
(`localLock` join in `finishLogin`) before reporting completion, though a
pending activation's compensation still runs to completion rather than
being eagerly awaited by B.

## Scope

- `android/app/src/syncLab/.../synclab/`: `SyncLabAccount` (new controller),
  `AuthVault`/`KeystoreAuthVault` (new Tink + Android Keystore, no-backup,
  atomic), `SyncLabApp` (sign-in/sign-up/confirmation/recovery/reset/settings
  routes, disabled Google action), `SyncLabRepository` (fenced finishLogin /
  selection / native activation), `SyncLabModule` (GoTrue 8287 / API 8187 /
  vault providers). Keycloak browser flow `SyncLabAuth.kt` removed from the
  lab; the AppAuth dependency stays for the PKCE helper only.
- `android/core/sync`: `SyncEngine.login/resume` accepted-predicate fencing
  (was unverified partial work, now compiled and tested).
- `integration/gotrue_fixture.py` exposes per-account synthetic credentials
  and the actually-expired token's refresh token to consuming tests;
  `integration/e2e.py` runs `SyncLabAccountTest` in the Android harness.
- `docs/integration/2026-10-19-gotrue-google-setup.md`: disabled Google
  preparation and approval-time setup only — no credentials or grants.
- `docs/integration/2026-10-19-gotrue-{design,plan}.md` updated to actual
  implementation status.

Native learning/mastery algorithms, Expo prototype, demo/prod graphs,
Keycloak services/volumes and all existing databases are unchanged. The lab
journal moved to a new path (`synthetic-gotrue-sync/`); the older
`synthetic-sync/` journal is left intact on device.

## Test evidence (all fresh, this checkpoint)

| Suite | Command | Tests | Failures | Skipped |
| --- | --- | ---: | ---: | ---: |
| Lab account unit (Robolectric, fake GoTrue+API, no fixtures) | `:app:testSyncLabDebugUnitTest --tests '*SyncLabAccountTest' --tests '*NativeRoomSyncTest'` | 28 | 0 | 2 (fixture-gated real-service tests) |
| Sync JVM + real GoTrue/Postgres/mail | `sh integration/run-e2e.sh` | 20 | 0 | 0 |
| Sync Android + real GoTrue/API/mail | `sh integration/run-android-e2e.sh` | 28 | 0 | 0 |
| Go race/Postgres (`99b2387`, unchanged backend) | `cd backend-umar && sh scripts/integration.sh` | 15 | 0 | 0 |
| Existing core regression | `:core:engine:test :core:content:test :core:content:validatePacks` | 154 (81 engine + 73 content; `core:model` has no test sources) | 0 | 0 |
| Existing data/app regression | `:core:data:testDebugUnitTest :app:testDemoDebugUnitTest --tests '*SessionViewModelTest' --tests '*StepMapperTest'` | 66 (40 data + 15 + 11) | 0 | 0 |
| Flavor compilation + lab APK | `:app:compileDemoDebugKotlin :app:compileProdDebugKotlin :app:assembleSyncLabDebug` | — | — | — |

Exit codes were captured from each command (no piped-tail masking); XML counts were
parsed from the Gradle `TEST-*.xml` reports. The plain unit run executes 26 of 28
lab tests (the two fixture-gated real-service tests skip without fixtures); both
real-service harnesses execute them with zero skips.

Fixture logs printed the real-service markers `REAL_GOTRUE_AUTH_PASS`
(signup; actual Mailpit delivery; confirmation required; email/password;
refresh rotation; recovery; logout; actual 60-second token expiry verified
401 at the API), `REAL_NATIVE_E2E_PASS`, `REAL_ANDROID_ACCOUNT_E2E_PASS`
(real GoTrue signup through the account controller; local Mailpit
confirmation; password login matching the API's durable owner; an
actually-expired fixture access token refreshed/rotated through the real
provider and resumed the same owner; logout; owner isolation) and
`REAL_ANDROID_ROOM_E2E_PASS` (unchanged prior repository coverage).

Review-finding regression tests added in `SyncLabAccountTest`:
`syntheticDomainIsRejectedBeforeAnyNetworkCall`,
`lateSignInCannotOverwriteANewerSignedInAccount`,
`failedRestoreCannotClearANewerSession`,
`signOutIsImmediateDespiteInFlightRefreshAndStorageFailure`,
`refreshRejectsProviderSubjectChangeAndOwnerMismatch`,
`logoutDuringLoginLearnerLoadCannotActivateOldProfile`, plus the rewritten
`googlePreparationFailsClosedUntilSetupApproved` (generation/state/replay/
expiry/clock-rollback/cancel/logout-invalidation) and
`concurrentRestoresSerializeRotationAndOneWins` (exactly one provider
rotation, both restores resume).

## Disposable emulator evidence (emulator-5586, Android 35, final APK)

`adb reverse tcp:8187/tcp:8287`; screenshots and dumps under
`.runtime/umar-integration/smoke-r2-*.png`. These are device auth checks — the
Room offline-answer/outbox and record-isolation evidence comes from the
real-service Robolectric suites above, not from the device.

1. Hub renders with the synthetic warning, explicit ack checkbox, disabled
   "Continue with Google — setup required" action.
2. Email/password sign-in with a disposable `syn-smoke-@example.invalid`
   account created against the local GoTrue/Mailpit — "Signed in as …".
3. Force-stop + relaunch: session restored from the encrypted vault without
   a password.
4. After an actual 60-second access-token expiry: relaunch transparently
   refreshed/rotated through GoTrue and remained signed in.
5. "Account & settings → Sign out": immediate local sign-out; hub returns to
   the signed-out state.
6. A second disposable account signed in after logout with no residue of the
   first account (per-owner isolation on device).
7. (Prior build, same flows) API process stopped: account actions fail safely
   with the session retained; API restarted: actions recover.

## Lint and known blockers (unchanged, accurately reported)

`:app:lintSyncLabDebug` is **not green** and was not made green: the four
pre-existing errors in unchanged baseline files remain —
`backup_rules.xml:6`, `data_extraction_rules.xml:8,13` (cache exclusion
outside included path), and the mid-file BOM in
`core/data/export/Export.kt:118`. No baseline or suppression was added.

- Google login: provider disabled (`GOTRUE_EXTERNAL_GOOGLE_ENABLED=false`);
  no Google Cloud project/client/credential was created or configured by
  this task. Live Google verification stays blocked on approved credentials
  and the emulator steps in the setup doc.
- Memvios reference path remains unknown; nothing was copied or asserted
  about it.
- AppAuth/system-browser redirect behavior was previously unverified; the
  lab no longer uses the browser flow at all, so that specific gap is moot
  for the lab. Callback-style handling exists only in the disabled Google
  preparation, whose validation is unit-tested.
- Local logout ends the app session immediately and attempts provider logout
  best-effort; offline logout cannot promise immediate remote revocation of
  already-issued tokens.

## Remaining limits

Same release blockers as the prior verification (real-data policy, guardian
ownership, retention/export/deletion, production TLS/redirect policy,
operational limits, journal quotas, device coverage). Synced progress remains
a separate native-algorithm view. No merge, push, publication or deployment
is authorized here; the external push decision belongs to the coordinator's
separate approval step.
