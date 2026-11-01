# Endpoint and database readiness checkpoint — 22 October 2026

The continuation uses the configured Codex GPT-6.1-Sol/XHigh task directly, with one writer.
PR #3 began at `0ad8eef14cbb2cd475433e74087d1c1450c4f8c2`, open/draft, with hosted CI green.
This work addresses technical gaps without changing owner policy choices or enabling real data.

## App environment isolation

The earlier configurable public origin reused one `.synclab.remote` Android application ID.
Updating that APK for another hostname could reuse its saved provider token and journal against
the new service. The build now derives an application ID from the exact canonical origin's
SHA256. Different origins have different Android sandboxes covering Room, active settings,
encrypted credentials and pending outboxes together. Same-origin rebuilds keep the same identity;
the original loopback `.synclab`, demo and prod IDs remain unchanged. Previous installations and
their queues are neither migrated nor deleted. No new authentication mechanism or crypto is added.

The dry-run tunnel planner derives the same ID and callback; the unapplied GoTrue override requires
that exact callback. `integration/verify-endpoint-isolation.py` runs actual Gradle BuildConfig and
merged-manifest generation for two remote origins and restores local output. It verifies distinct
packages and exact redirect schemes, without installing an app, authenticating or creating a tunnel.
The regression failed the old shared identity before the fix and passed with the implementation.
This does not cover replacing the server database/keys at an unchanged origin or a physical device.

## Restricted database runtime

The API supports `UMAR_MIGRATE_ON_START=false`; the local default remains automatic migration.
The new one-shot `cmd/migrate` prepares schema/catalog without starting HTTP. The restricted path
verifies exact migrations and catalog provenance read-only, then refuses excess or missing runtime
privileges. [Preparation instructions and secret-free templates](../../backend-umar/deploy/README.md)
separate migration from an approved non-owner runtime identity. No existing role, credential,
provider configuration, volume, immutable trigger or public exposure was changed.

Account activation no longer needs UPDATE permission. Concurrent activation/profile retry still
returns one owner/profile; account namespace remains issuer + subject. Only learner sequence UPDATE
is granted. A fresh disposable Postgres test uses a unique temporary NOLOGIN role, tests the ordinary
account/guardian/event/replay/withdraw/regrant path, verifies foreign-owner denial, and confirms SQL
permission errors for schema changes, event mutation/truncation and account/owner reassignment.
It also proves startup rejects excessive/missing rights, a database-owner runtime, newer migrations
and changed catalog provenance. The role is removed with the disposable test context; no ongoing
access credential is created. This is least-privilege runtime preparation, not database RLS.

## Automated release checks

The new backend workflow exercises the full race suite with a fresh runner-local Postgres service,
vet/build and tunnel-helper tests. The Android workflow now also covers sync contracts/account tests,
production lint/unsigned assembly and generated endpoint isolation. Real GoTrue/Mailpit fixture
tests remain separate local runs, not claims made by a mock-only CI job. No deployment or signed
release job is added. Existing nonblocking ktlint policy is unchanged.

Local verification on the final implementation:

- Full backend: **26 top-level tests**, zero failures/skips, race detector, fresh disposable
  Postgres 16; `go vet ./...` and `go build ./cmd/...` passed.
- Existing Android gate: **81 engine + 73 content + 40 data + 294 demo app tests**, zero
  failures/errors/skips; pack validation, demo lint/assembly, production lint/unsigned release
  assembly and existing ktlint task passed. Existing lint/style findings are not claimed absent.
- Full syncLab unit gate: **359 tests**, zero failures/errors, **2 expected live-fixture skips**.
  The standalone core-sync gate has **20 tests**, zero failures/errors and one expected fixture skip.
- Separate sequential real-service runs: **20 JVM + 62 Android account/Room tests**, zero
  failures/errors/skips against preserved isolated GoTrue/API/Mailpit, including real issued-token
  expiry. Fixture token files were removed afterward; no service was restarted.
- **7 Python helper tests**, actual two-origin BuildConfig/merged-manifest isolation and matching
  planner callback checks passed. The origin-specific APK assembled; the local APK was rebuilt
  afterward. GoTrue Compose was validated read-only for issuer/external URL/callback agreement,
  disabled signup and loopback binding. No override was applied or device installation performed.

Hosted exact-head workflow results are separate evidence, recorded in the PR after publication.

## Remaining decisions and approvals

All 3162 catalog items across 73 packs are still draft; production gating excludes draft/synthetic
content. API/schema and native integration remain synthetic-only. Author-reviewed release content,
real collection purposes/consent/age assurance (including guardian ownership and Arabic 18+), server
export/deletion/retention and backup recovery policy need owner/product/legal decisions. Real SMTP,
TLS/domain/redirect policy, key/role provisioning, monitoring, storage limits, coupled backup/restore,
release signing/store setup and physical-device checks are not completed by these synthetic tests.

Ngrok sign-in remains pending. The previous Google attempt required an unapproved email-sharing
grant and was cancelled; it was not retried. Account hostname/credit/plan/cloud Full Capture must be
verified, along with the actual tester egress IP and action-time exposure/restart approval. Agent
`--inspect=false` alone does not establish cloud capture settings. Existing Expo agents stay intact.

When the owner is ready, the existing Mac GitHub login offers a passkey route; GitHub documents using
an already registered passkey on a nearby phone via QR/Bluetooth. That requires physical proximity;
it is not an away-from-Mac device-code flow. No QR/MFA or new passkey/grant was triggered here.
[Official passkey instructions](https://docs.github.com/en/authentication/authenticating-with-a-passkey/signing-in-with-a-passkey).
Signing into the dashboard on a phone can reveal account metadata but does not sign the Mac browser in.

Verification results and publication are recorded in the PR after the local and hosted checks finish.
The [21 October release report](2026-10-21-production-and-mac-test.md) remains background for wider
release gaps; its fixed remote-ID description is superseded by this origin-specific identity.
