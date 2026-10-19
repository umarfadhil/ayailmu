# WIP checkpoint — 19 October 2026

This branch is an explicitly incomplete draft. Passing checks below establish a
useful synthetic integration slice; they do not close the remaining review
findings or establish release readiness. No real learner data or live Google
identity was used. Publication as a WIP draft was explicitly authorized.

## Scope and launch

`feature/umar-native-integration-20261019` contains the separate Go/Postgres
backend and optional Android `.synclab` application. The existing demo/prod graph,
native scoring/mastery algorithms, Expo prototype and Amar services remain outside
this integration. Backend writes require `synthetic:true`; the lab accepts only
fabricated adult identities and explicit synthetic acknowledgement/sync opt-in.

See [local launch instructions](../../integration/README.md). Current GoTrue mode
uses Compose project `umar-native-integration`, API loopback `8187`, GoTrue `8287`,
Mailpit `8387`, and the existing isolated Umar integration app database `6586`.
GoTrue identity has its own volume. The earlier Keycloak services and volumes are
preserved. Secrets stay in ignored local files. No public hosting or deployment.

[Backend architecture/schema/API](../../backend-umar/docs/architecture.md) records
the source-pinned contracts, ownership and immutable/idempotent event model.
[GoTrue design](2026-10-19-gotrue-design.md) describes the additive identity mode.
Google remains disabled and unconfigured; no Amar OAuth credentials are reused.

## Writer and interruption

Earlier account checkpoints used Kimi K2.8. The latest repairs were authored only
by the existing Kimi Code CLI session after switching to exact model
`kimi-code/k3`, provider model `k3`, thinking effort `max`. The supervisor verified
an actual request and response with that selection, not just a startup flag.
Codex performed read-only review, independent validation and checkpoint transport;
it did not patch product/test source in this repair round.

At 15:52 UTC the K3 provider returned HTTP 429 for the account's five-hour usage
limit. A subsequent submitted review handoff also returned 429 at 15:59 UTC; no
reset timestamp was supplied. The CLI exited cleanly, with no implementation or
Gradle worker left running. No model fallback, new login, quota purchase or second
writer was started. Repair instructions remain in the same saved session.

## Fresh verification of the frozen source

Independent supervisor runs on this exact K3 source, after the writer exited:

| Check | Result |
| --- | --- |
| `cd backend-umar && sh scripts/integration.sh` | PASS: 15 top-level tests, zero skips; `go test -count=1 -race -v ./...`, own temporary Postgres 16 cluster |
| `sh integration/run-e2e.sh` | PASS: 20 tests, zero failures/errors/skips; XML written 16:02 UTC |
| `sh integration/run-android-e2e.sh` | PASS: 40 tests, zero failures/errors/skips; XML written 16:04 UTC |
| Fixture cleanup | Private token fixture absent after each run; suites run sequentially under their exclusive fixture lock |
| Source stability | Reviewed source/test hashes unchanged across the independent checks |
| Current APK | Installed over existing disposable Android 35 lab app; cold launch succeeded and restored the fabricated account |

Private logs: `/tmp/umar-final-go.log`, `/tmp/umar-final-jvm.log`,
`/tmp/umar-final-android.log`. They are local evidence, not repository deliverables.
JVM/Android logs include actual GoTrue signup, local Mailpit confirmation/recovery,
refresh rotation, issued-token expiry, logout, exact-byte/offline retries and
owner/learner isolation markers. This is HTTP/Room evidence, not a complete
emulator learning-flow test.

Before the quota interruption, K3 also completed demo/prod Kotlin compilation,
`assembleSyncLabDebug`, and the selected 26 SessionViewModel/StepMapper tests
(`/tmp/umar-flavors.log`, successful at 15:52 UTC). Plain focused lab unit tests
passed 38 executed/40 total with two fixture-gated skips; the later real-service
run above executes all 40. APK SHA-256:
`19987935f7773b051a0438b830bd25e8b038445bd95c09f93a93c9800de9d733`.

## Unresolved Important review findings

1. **Learning readiness/navigation can become stale.**
   `SyncLabRepository.prepareLearning()` activates A, then suspends in the consent
   lookup after releasing the local lock. B can sign in without a binding before
   A returns `READY`; the ViewModel callback can open A's learning route. Carry
   owner/binding/session fences across both the consent read and the actual
   success callback after IO/Main dispatch. Add a deterministic regression.
2. **Coroutine cancellation after engine commit leaves unpersisted live auth.**
   In sign-in/confirmation/disabled Google preparation, `repository.login()` can
   commit engine authentication and suspend loading learners before the caller
   sets `committed=true` or installs the vault. Cancellation is rethrown without
   attempt-specific cleanup or clearing busy state. Cleanup must survive
   cancellation and preserve any newer account. Also assert signed-out owner state
   after cancelled Google preparation; expiring memory alone retains the owner.
3. **Some race tests do not await the effect they claim.**
   `lateActivationCannotOwnCurrentSession` can accept the initial null before the
   compensating clear. The old-request failure tests poll a shared exit queue that
   may return B/A2's completed learner request; HTTP exit also precedes VM failure
   handling. Await exact request and handler/compensation completion milestones.

Nearby Minor findings: a superseded learner-load 503 can publish an old notice over
a newer account; auth route composition is not identical to current-entry
visibility during transition animations. These are recorded, not silently closed.
The Important schedules above remain unproven even though all existing tests pass.

## Existing baseline and release limits

The unchanged main commit `815e30f0da284b9818fadc0143f4da92544384d3` has a
[failed Android gate](https://github.com/umarfadhil/ayailmu/actions/runs/39132023211)
with the demo `StoryTest` gallery-state failure. Full app CI is not claimed green.
Four prior lint errors remain in `backup_rules.xml:6`,
`data_extraction_rules.xml:8,13`, and `core/data/export/Export.kt:118`; no suppression
or unrelated repair is included. The full unfiltered demo/lint/ktlint gate was not
rerun for this WIP checkpoint; the draft PR will trigger the existing workflow.

Real-data policy/consent, guardian eligibility and Arabic 18+, retention/export/
deletion, production TLS, restricted roles, quotas, operations and broader device
coverage remain release blockers. Native mastery is unchanged, and synced progress
is not equated with Amar Arabic metrics. No merge or deployment is performed.
