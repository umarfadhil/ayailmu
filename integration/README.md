# Umar native sync laboratory

> **Synthetic lab:** [current endpoint/database readiness checkpoint](../docs/integration/2026-10-22-endpoint-and-runtime-isolation.md), [release/test preparation and limits](../docs/integration/2026-10-21-production-and-mac-test.md), [completed account-race checkpoint](../docs/integration/2026-10-20-route-ownership-checkpoint.md). Use fabricated data only.

This is a local **synthetic adult-only** integration of the Kotlin app and the
separate `backend-umar` API. It is not a real-data or release configuration. The
backend API/schema and native scoring/mastery algorithms are unchanged. The
normal demo/prod app entry points do not include this auth/sync implementation.

## Start the separate local services

Requires Docker Compose, Go 1.27+, Python 3, JDK 17, and Android SDK 36 for the APK.
Run from the repository root:

```sh
sh integration/init-local.sh
. integration/.local/stack.env
docker compose -f integration/compose.yaml up -d
sh integration/run-api.sh
```

The API binds `127.0.0.1:8186`, PostgreSQL `127.0.0.1:6586`, and Keycloak
`127.0.0.1:8286`. Compose project `umar-native-integration` owns distinct application
and identity volumes. All credentials and fixture identities live in ignored
`integration/.local/` files. Do not commit, share, or reuse them. No production
identity/provider, shared database, Firebase or Google account is required.

Keycloak uses a dedicated imported realm, public `umar-native` client,
authorization code + S256 PKCE, audience `umar-api`, and `umar.sync` scope. Direct
password/implicit/service grants and self-registration are disabled for that
client. A fixture helper uses the local administrative bootstrap account solely
to provision fabricated accounts, then signs them in through code + PKCE.

## The GoTrue lab stack (current lab flow)

The lab now authenticates against an isolated Supabase GoTrue provider instead of
the Keycloak browser flow (Keycloak remains for regression coverage). Bring the
new stack up alongside the preserved services, then run the GoTrue-backed API:

```sh
sh integration/init-gotrue.sh
docker compose -f integration/gotrue.compose.yaml up -d
sh integration/run-gotrue-api.sh
```

GoTrue binds loopback `8287` (JWKS at `/.well-known/jwks.json`), the GoTrue-mode
API binds `8187`, and the local Mailpit UI binds `8387`. Confirmation and recovery
require the six-digit codes delivered only to the local Mailpit inbox; autoconfirm
is off and access tokens expire after 60 seconds (refresh rotation is exercised
for real). Google sign-in is prepared but disabled
(`GOTRUE_EXTERNAL_GOOGLE_ENABLED=false`); no Google project/client/credential was
created or configured by this task — see
`docs/integration/2026-10-19-gotrue-google-setup.md`.

## Verify the native flows

```sh
sh integration/run-e2e.sh
sh integration/run-android-e2e.sh
JAVA_HOME=/path/to/jdk17 sh android/gradlew -p integration-jvm test --no-daemon
JAVA_HOME=/path/to/jdk17 sh android/gradlew -p android :app:assembleSyncLabDebug --no-daemon
```

Set `JAVA_HOME`, `GRADLE_USER_HOME`, and Android SDK location as appropriate for
your machine; `android/local.properties` is ignored. The two E2E scripts mint fresh
synthetic accounts, keep tokens out of terminal output, and remove the token file
on exit. They require the local services above. They never delete existing users
or databases. An exclusive fixture lock covers generation and the consuming test;
run these suites sequentially. The Android E2E is a Robolectric test of real Room, native
`RoomSessionStore`, and the Android repository against the actual HTTP API. It is
not a system-browser/device test. The pure JVM suite also tests actual native
Session/SkillProjector behavior, server-committed retry, signed expired tokens,
provenance checks and account isolation. Running without fixture environment skips
only the real-service tests; the E2E scripts supply that environment explicitly.

## Try the separate Android app

```sh
python3 integration/make-fixtures.py
adb reverse tcp:8187 tcp:8187
adb reverse tcp:8287 tcp:8287
adb install -r android/app/build/outputs/apk/syncLab/debug/app-syncLab-debug.apk
adb shell am start -n id.petalytix.ayailmu.synclab/id.petalytix.ayailmu.MainActivity
```

Use a disposable emulator/device and only fabricated `@example.invalid` accounts
(sign up in-app, then read the six-digit confirmation code from the local Mailpit
UI at `127.0.0.1:8387`). The application has its own `.synclab` ID and local
database. Loopback cleartext is restricted to this flavor. Sign-in happens in-app
with email/password (no browser); the persisted provider session lives in a Tink
AEAD + Android Keystore vault under no-backup storage, so a restart restores the
durable owner and rotates expired tokens transparently. Local sign-out clears the
account, credentials, selection and profile immediately and attempts provider
logout best-effort; it cannot promise immediate remote revocation of already-issued
tokens. A production redirect/TLS/logout policy needs separate review.

The hub creates fabricated ADULT profiles with a fixed placeholder year (1980),
not a real age declaration. A separate synthetic sync acknowledgement and opt-in
are required. Arabic's existing trial consent screen still runs; lab text clearly
describes this as simulation. Only original `synthetic:true` Arabic `DEMO-*`
answers can enter the outbox. Learning and native Room writes work offline.
Sync is manual. Turning it off stops local uploads immediately, with a durable
pending withdrawal if offline. Prior opted-in pending answers are retained;
historical/off-period answers are not automatically backfilled. Owner and learner
namespaces fence retries, cursors, remote progress and late responses.

Synced progress is a separate read-only lane using the unchanged native
`SkillProjector` after matching pack/rules versions and SHA256. Remote events do
not enter native Room history or change local mastery. This is not equivalent to
Amar's Arabic metrics. No ordinary app profile picker, purchases, child data entry,
or automatic background upload is exposed in the lab graph.
The lab skips the ordinary activity's Play purchase refresh. Existing non-lab
flavors already inherit an INTERNET permission from their Google Data Transport
dependency despite the main manifest's comment; this integration adds no auth or
sync implementation to those flavors and does not change that dependency.

## Release boundaries

For optional remote synthetic testing, see [temporary Mac tunnel preparation](tunnel/README.md). The public-origin Gradle property produces an origin-specific `.synclab.remote.r<SHA256>` app, isolating credentials and offline data across hosts; it does not enable sync in demo/prod. No public tunnel has been approved or opened by preparing these files.

Before real-data use: review actual purposes and consent/policy wording, adult and
guardian ownership, per-learner eligibility including Arabic 18+, retention,
export/deletion and reconciliation. Add production TLS/redirects, restricted DB
roles, rate/size/storage controls, operational monitoring and device/browser
coverage. The JSON journal is a bounded-test-volume prototype; storage quotas and
compaction need review before sustained use. Do not publish this branch, deploy,
or connect real accounts without explicit authorization.

Stop only this stack with `docker compose -f integration/compose.yaml stop`. Do not
use volume deletion commands against existing Umar or Amar projects.
