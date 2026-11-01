# Synthetic native/backend integration verification

Verified on 19 October 2026, approximately 02:26 UTC, with one Codex writer and a
read-only Codex review. Integration branch remains local:
`feature/umar-native-integration-20261019`.

## Source and scope

- Native main: `815e30f0da284b9818fadc0143f4da92544384d3`, rechecked against GitHub.
- Backend base: `e49084251353c0f1fc17731e44921769ff6cb65c`.
- Design/plan: `8745c47`; core client: `6b8e219`; Android lab/harness: `8f5d486`.
- Worktree: `umar-native-integration`, separate from `umar-native-backend` and
  Amar's Arabic worktrees. No merge, push or deployment of this integration.
- `backend-umar`, native model/content/engine sources are byte-for-byte unchanged
  from the backend base. The Room change adds two read-only payload queries; no
  entity, schema, migration, transaction or native mastery algorithm changed.

The `.synclab` flavor creates fabricated ADULT learners only. Only original native
Arabic `DEMO-*` answers marked synthetic are eligible. No existing real profiles,
child data, real identity accounts, production grants or purchases were used.
Actual guardian/child eligibility and real-data policy remain release work.

## Passed checks

| Suite | Tests | Skipped | Failures/errors |
| --- | ---: | ---: | ---: |
| Existing native content | 73 | 0 | 0 |
| Existing native engine | 81 | 0 | 0 |
| New Kotlin sync, including real services | 16 | 0 | 0 |
| Existing Android data/Room | 40 | 0 | 0 |
| Existing Android session and mapping | 26 | 0 | 0 |
| Android lab Room/Auth, including real services | 3 | 0 | 0 |
| **Total** | **239** | **0** | **0** |

The Go suite also passed `go test -count=1 -race -v ./...` against a fresh temporary
Postgres cluster on port 16585, with no DB skips. It covers authorization/claims,
ownership, consent, concurrent/idempotent events, provenance, all catalog activity
types including trace/story, and immutable native JSON handling.

Commands (see [launch instructions](../../integration/README.md) for prerequisites):

```sh
sh integration/run-e2e.sh
sh integration/run-android-e2e.sh
sh android/gradlew -p integration-jvm test --no-daemon --max-workers=2
sh android/gradlew -p android :app:compileDemoDebugKotlin :app:compileProdDebugKotlin :app:assembleSyncLabDebug :core:data:testDebugUnitTest :app:testDemoDebugUnitTest --tests '*SessionViewModelTest' --tests '*StepMapperTest' --no-daemon --max-workers=2
cd backend-umar
sh scripts/integration.sh
```

The ordinary JVM command skips the environment-gated real-service test; the
separate E2E run supplies fresh fixtures and passed all 16 sync tests without
skips. JDK 17, a task-local Gradle cache and Android SDK 36 were used. Tests used
standard Robolectric SDK artifacts; no physical device or emulator was operated.

## Real flow evidence

Both real-service tests passed using the actual Go API, PostgreSQL and Keycloak:

- Code + S256 PKCE creates local synthetic authenticated sessions. The Android
  AppAuth request contract is tested against AppAuth 0.11.1 itself; password/implicit
  grants are disabled on the native client, tokens are memory-only.
- Actual native `Session.submit` produces answers. Android's real
  `RoomSessionStore` commits the answer/snapshot, and the new observer preserves
  the saved payload string exactly.
- Consent off excludes old answers. Offline capture persists an opted-in outbox;
  the JVM flow restarts the journal and explicitly signs in again.
- A real server commit followed by a simulated lost response leaves the answer
  pending. Retry receives the same event once, with original payload bytes.
- A second client/repository pulls history and runs the unchanged native
  `SkillProjector`; remote history never enters native Room/local mastery.
- Remote revocation freezes pending answers and hides the remote lane. An actual
  signed expired token requires re-login. Logout and account switching preserve
  owner/learner isolation; the other owner's direct API read returns 404.
- Late consent grant and pending-withdrawal interleavings, late owner responses,
  malformed receipts/pages, native profile ID collision, and provenance mismatch
  have regression coverage. Reviewed bugs were reproduced failing before fixes.

The fixture harness exclusively locks generation plus consuming tests, restores
the dedicated lab client's normal five-minute lifetime, rejects a concurrent
fixture writer, and removes temporary token files after runs. It does not remove
existing accounts or databases. No tokens, passwords, runtime state or APK files
are committed.

## Build and runtime boundaries

Demo/prod debug compilation and syncLab debug APK assembly passed. Generated
BuildConfig enables sync only for syncLab. Merged manifests have AppAuth components
and the loopback network configuration only in syncLab; its allowBackup is false.
Demo/prod already inherit INTERNET through Google Data Transport, despite the
existing main-manifest comment. Their auth/sync runtime dependencies and app graph
are unchanged. The lab skips ordinary Play purchase refresh.

APK: `android/app/build/outputs/apk/syncLab/debug/app-syncLab-debug.apk` (about 19 MB).
SHA256: `99aebad6ce3710b1402760987e54152c0e6595ac5cc26427f4956bb84e9191be`.

Compose project `umar-native-integration` has its own data and identity volumes.
API8186 `/healthz` returned `{"status":"ok"}`; `/readyz` returned
`{"status":"ready"}`. DB6586 and auth8286 are loopback-only; identity DB has no
published port. Original backend API8185/DB6585/auth8285 and Amar runtimes were not
modified. Services remain available locally for inspection.

Full `:app:lintSyncLabDebug` is **not green**: it reported four errors in unchanged
baseline files: three FullBackupContent errors in `backup_rules.xml` /
`data_extraction_rules.xml`, and a mid-file BOM in `core/data/export/Export.kt`.
No lint baseline or suppression was added. These files match the backend base.

## Remaining limits

AppAuth/system-browser redirect behavior has not been exercised on a device;
Robolectric and the HTTP code+PKCE fixture are not a substitute for that test.
Local logout clears app tokens/selection but does not terminate the browser's
provider session; the next login requests fresh authentication.

Before any real-data release: review purposes/consent, guardian ownership and
per-learner/Arabic 18+ eligibility, retention/export/deletion, reconciliation,
production TLS/redirect/logout policy, restricted DB roles, operational limits,
journal quotas/compaction and device coverage. Synced progress remains a separate
native-algorithm view; no equivalence to Amar's Arabic metrics is asserted.
No release, public branch publication or production connection is authorized here.
