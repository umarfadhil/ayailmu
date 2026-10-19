# GoTrue Android account connection — verification

Verified on 19 October 2026 (approx. 17:20 local) by the Kimi Code CLI writer
(K2.8 Preview, max thinking), sole implementation/test writer for this
checkpoint. Branch `feature/umar-native-integration-20261019`, local only.
Base checkpoints: published `3b4f2064103fe6514c314b9e9b60adcf6c9479ff`,
GoTrue slice `90ccf1f`. **No push, no PR, no deployment.**

A prior read-only Codex review of the unfinished draft
(`.runtime/umar-integration/kimi-readonly-review-notes.md`) raised ten findings;
each was reproduced with a failing test and fixed before this checkpoint
(synthetic-domain gate before any network call; generation fences on every
credential write/clear/publish and on native profile activation; immediate
local logout despite in-flight refresh and storage failure; runtime
refresh/reauth actions; account busy merged into the UI; Google callback
validation by generation/state/expiry/replay/clock-rollback). No finding was
worked around by weakening a test.

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
| Lab account unit (Robolectric, fake GoTrue+API) | `:app:testSyncLabDebugUnitTest --tests '*SyncLabAccountTest' --tests '*NativeRoomSyncTest'` (no fixtures) | 18 | 0 | 2 (fixture-gated real-service tests) |
| Sync JVM + real GoTrue/Postgres/mail | `sh integration/run-e2e.sh` | 20 | 0 | 0 |
| Sync Android + real GoTrue/API/mail | `sh integration/run-android-e2e.sh` | 18 | 0 | 0 |
| Go race/Postgres | `cd backend-umar && sh scripts/integration.sh` | 15 | 0 | 0 |
| Existing core regression | `:core:model:test :core:engine:test :core:content:test :core:content:validatePacks` | 154 (81 engine + 73 content; `core:model` has no test sources) | 0 | 0 |
| Existing data/app regression | `:core:data:testDebugUnitTest :app:testDemoDebugUnitTest --tests '*SessionViewModelTest' --tests '*StepMapperTest'` | 66 (40 data + 15 + 11) | 0 | 0 |
| Flavor compilation | `:app:compileDemoDebugKotlin :app:compileProdDebugKotlin :app:assembleSyncLabDebug` | — | — | — |

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

## Disposable emulator evidence (emulator-5586, Android 35)

`adb reverse tcp:8187/tcp:8287`; screenshots and dumps under
`.runtime/umar-integration/smoke-*.png`:

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
6. Second disposable account signed in after logout with no residue of the
   first account (per-owner isolation on device).
7. API process stopped: account actions fail safely ("The action did not
   finish. Local data is unchanged."), session retained; API restarted:
   actions recover ("Choice saved.").

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
