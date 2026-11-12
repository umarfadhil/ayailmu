# Account erasure source readiness

11 November 2026. Source and isolated tests only. No deployment, credential/access change, real account operation, email or store submission was performed. This is not public-release acceptance.

## Implemented contract

- `POST /v1/account/deletion` requires a verified fresh normal owner, explicit `confirmed: true`, that owner's `account_id`, a durable UUID `request_id`, and a client-generated 256-bit lowercase hexadecimal `recovery_token`. The complete request is at most 1024 bytes. Queries, cookies, duplicate/unknown JSON fields, foreign identities and synthetic accounts are rejected.
- The transaction serializes with profile creation and learner event/consent writes, erases all owned learner data including children, and records the account tombstone and provider-deletion job atomically. It retains only existing deletion receipts and the account identity/declaration metadata needed for anti-replay and audit, plus minimal job/receipt metadata. This is not a promise to remove every retained identifier or backup immediately.
- App data erasure commits before any provider call. The response is 202 with `identity_deletion_pending`, not a claim that the authentication account is gone. A repeated identical request returns the same receipt. Changing request/proof is a conflict. A recovery-proof collision rolls the whole transaction back rather than partially erasing data.
- The account identity tombstone blocks stale token activation and new profiles. Direct runtime profile insertion is also refused after account erasure. Existing runtime DELETE/TRUNCATE/account UPDATE/job-table write permissions remain denied.
- A worker claims one due normal-account job for its exact provider issuer with a 30-second lease and new lease UUID. GoTrue deletion is bounded to ten seconds. Known success or precise `user_not_found` marks completion; timeout, redirect, malformed response and all other outcomes stay pending. Failed attempts use bounded one-minute to one-hour backoff; expired leases recover after a crash. A late worker cannot overwrite a newer lease. Transient database errors retry with bounded 1–30 second delays rather than silently stopping the worker.
- `POST /v1/account/deletion/status` takes only `request_id` and `recovery_token`. It is intentionally available without Auth, because the identity may already have been deleted before the client received a reply. It only returns the exact minimal receipt/state/timestamps and cannot erase, advance a job, read learner data or restore sign-in access. The server stores SHA-256 of the proof, not the proof. The gateway sends no bearer token or cookie to this route, makes no Auth inspection, applies the existing per-IP auth-rate limit, and strictly validates the response.
- Status is 200 with `deletion_id`, `scope: account`, `request_id`, `status`, `app_data_erased_at`, and `identity_deleted_at` only when completed. No email, provider subject, account ID, learner details or recovery proof is returned. The status route remains available if learning readiness or new account-erasure initiation is later disabled.

## Source activation requirements, not actions performed

The default constructor does not initiate provider deletion. Server activation requires all of:

- `UMAR_ACCOUNT_ERASURE_ENABLED=true`.
- `UMAR_DATA_MODE=NORMAL_ONLY` and `UMAR_AUTH_PROVIDER=gotrue`.
- An explicitly approved HTTPS root `UMAR_AUTH_ADMIN_ORIGIN`, with the configured existing issuer unchanged.
- `UMAR_AUTH_ADMIN_TOKEN_FILE` pointing to an existing regular server credential file with no group/other permission bits. The bounded loader never prints its path or content. No credential is created or discovered.
- System-trusted TLS for the provider adapter. The current private-CA deployment does not satisfy this by default. Resolve an approved trust/routing design; never disable TLS verification or expose an admin credential in a native build.
- Both additive migrations 0004 and 0005 and the current narrow runtime EXECUTE grants. Startup checks require the new functions. Apply with the approved migrator/role only after explicit rollout approval and verified backup/restore.

The runtime supervises the coordinator alongside the HTTP service, cancels it on shutdown and keeps durable pending work in PostgreSQL. All configuration files, migrations and grants in this change are source-only. No service was restarted or enabled.

## Verified

- Full disposable PostgreSQL race run: 157 top-level tests passed, two subprocess-helper skips. Includes owned all-learner removal, foreign-owner refusal, immutable recovery identity, duplicate request, failed transaction rollback, stale account activation/profile rejection, direct restricted-role denial, concurrent creation/upload/claims, lease expiry and late-worker fencing.
- Coordinator tests cover durable pending state before provider I/O, restart using persisted state, provider failure/backoff, status after Auth removal, bounded database retry timing, worker completion and cancellation.
- HTTP and gateway tests cover fresh auth, explicit confirmation, exact owner, 202 pending versus completed, anonymous proof-only recovery, no-store, no metadata leakage, malformed/foreign proof, query/unknown-field refusal, gateway rate limits, no bearer/Auth forwarding and strict response shape.
- Provider TLS tests cover exact hard-delete body, all redirect classes blocked before forwarding, no cookie jar, fixed errors, malformed/duplicate/oversized responses, cancellation and redacted pointer/value formatting. Go vet passes.
- Independent source review of the store/coordinator found no blocking issue. Its database retry recommendation was implemented. The independent API/gateway/runtime review also found no blocking issue and independently reran four affected race-tested packages. Its optional empty-query consistency note was implemented with regressions.

Logs: the Mac task's `2026-11-11/ayailmu-public-launch-audit/account-erasure-*.log`, `account-api-*.log`, `account-ingress-*.log` and `account-runtime-red.log`. No live database was used.

## Still required before launch

1. Native account-wide controls are implemented in source. Complete disposable-device Keystore/Keychain, interruption, reboot, native transport and visual acceptance, using the approved public configuration. Proofs must remain separate from learning exports and survive session loss; local history must remain owner-scoped.
2. Integrate the separate iOS snapshot into the release source; its current-local-owner persistence refinement is now implemented and fixture-tested. Fixture and unsigned compile results do not establish real-device/provider acceptance. Keep learner-copy and account-wide controls distinct.
3. Verify the actual GoTrue version/admin deletion contract and approved provider transport/authority in a non-live acceptance environment before real-account testing. A fixture pass is not live-provider acceptance.
4. Approve and implement retention for tombstones/receipts, identity metadata, logs and backups. A restore must not reintroduce previously erased data; deletion-ledger recovery/replay needs an operational test. The current code does not erase historical backups or establish a retention deadline.
5. Provide a user-facing public deletion-request webpage/process and reconcile privacy/consent/store forms. This proof-only API is not a substitute for a discoverable web process for people who no longer have the app.
6. Complete all other public configuration, curriculum, platform parity, commerce, signing and real-device launch gates. Full feature scope has not been narrowed.


## Native account deletion source, 2026-11-11

Android now has a separate account-wide control, in addition to learner-copy erasure. The confirmed intent creates one CSPRNG 32-byte proof and request UUID, saves it in origin-bound Keystore-encrypted no-backup storage, fsyncs the file and directory entries, then freezes all owned uploads before any deletion call. The proof is not in the learning journal or export, and ordinary logout does not clear it. Device-wide local reset explicitly warns that it removes the recovery proof without cancelling a server request. The reset gate spans normal namespaces and the complete Room/settings/files reset; errors or cancellation keep account actions closed.

Anonymous status is always attempted before an explicit retry; only a definite unregistered result can lead to re-sending the same confirmed request with the same fresh owner. A status check never initiates erasure. Strict receipts distinguish unknown, app data erased/identity pending, and both completed. Inconsistent, duplicate, wrong-request and regressing receipts fail closed. Completion retains offline owner bindings/history and clears credentials only for the matching owner and Auth subject. Engine-to-account lock ordering prevents completion/restore deadlock; newer other-owner sessions are unaffected.

The dedicated native HTTP client uses pinned OkHttp 4.12.1, the official 2026-10-22 security backport with the certificate blocklist. OkHttp 5.5.1 was investigated but requires compileSdk 37; it was not forced into this SDK 36/AGP 8.12.2 project. The compatible security-patched branch avoids an unrelated toolchain migration. No custom trust manager, cookie store, authenticator, redirect following or automatic body replay is enabled. A one-shot body also refuses Retry-After: 0 replays. Android TLS fixture tests exercise both methods and same-/cross-origin HTTPS redirects. Licenses are shipped as an exact allowlisted asset, without expanding the curriculum allowlist.

Android verification: 688 reported tests, 677 pass and 11 optional live-wire skips, zero failures/errors. Both unsigned prod/demo assemblies and both lint variants pass (0 errors, 639 warnings, 3 hints); six exact APK/assets checks pass with unchanged reviewed curriculum and full demo catalog. The parallel build initially hit an Android lint generated-Hilt-file race; serial build/lint rerun passed without source changes or suppressions. Independent review cleared the corrected completion lock order, directory durability, owner/status boundaries and whole-device-reset lifecycle. Both actual DataResetter regressions failed under the earlier order and passed under the fix. JVM/Robolectric tests exercise real encryption with a test AEAD and host directory persistence; they do not establish hardware Keystore or Android filesystem power-loss behavior.

The separate iOS snapshot now includes account-wide confirmation, a separate ThisDeviceOnly/non-synchronizable Keychain proof ledger, strict receipts, anonymous status and owner-wide SQLite upload fences. A single current-local-owner record, created only while clearing that same verified session, preserves offline history across restart without retaining Auth credentials. Logout deletes this pointer. Historical proofs cannot restore a previous owner's history or network access. Startup, corruption, owner/session changes and interrupted writes fail closed. All 96 Swift tests and 25 source/configuration checks pass; unsigned ARM64 simulator compilation/linking passes. A second independent run of all 96 Swift tests passed, and the 12-file patch/hash manifest was verified. The snapshot still needs deliberate release-source integration.

Neither native platform has actual-device secure-storage, power-loss/interruption or public-provider lifecycle acceptance. Neither client nor server has been deployed for these changes. No real data was erased, app installed/launched, or distribution signing performed. See the Mac audit folder's NATIVE-ACCOUNT-ERASURE-READINESS.md for final artifacts and test counts.
