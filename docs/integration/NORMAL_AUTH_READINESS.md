# Normal owner auth and learning sync — readiness record

Status: **COMPILED / synthetic-fixture verified 2026-10-26; real-user release NOT READY**. Normal auth is disabled in every default build. This document records implementation and missing owner approvals; it does not approve policy, curriculum, deployment, or real-user activation.

## Implemented boundary

- Non-lab demo/prod source contains the actual Settings → Owner account route: email/password registration, explicit adult/guardian declaration (not age verification), six-digit confirmation, resend, sign-in, recovery/reset, confirmed-user status, logout/relogin and session restoration. Registration itself never installs a session. GoTrue `/user` must confirm the same subject/email and a nonblank confirmation time before the API owner and encrypted session are accepted.
- Sessions use the existing GoTrue HTTP adapter and a normal-only Tink AEAD/Android Keystore vault in no-backup storage. Vault and journal namespaces bind the canonical public origin. Refresh rotates only after a real 401; valid restoration does not rotate. Durable local clear must succeed before sign-out is reported.
- Normal sync uses the existing owner-fenced `SyncEngine`, immutable native `AnswerEvent` payloads, per-track `PackProof`, a persistent owner/learner outbox, idempotent receipts, cursor pulls and Room replay. Native scoring/planning algorithms are unchanged. Trace, story and the other native response contracts remain server-validated.
- Only a newly created, explicitly selected adult owner learner can sync. Existing unbound device profiles/history are never attached or backfilled. Enabling sync ignores pre-enable answer IDs. Unbound offline profiles remain usable. Bound profiles are visible only to their current owner/environment, including after restart, readiness rollback or origin change. Visibility uses a small atomically refreshed in-memory index; corruption/loading fails closed without deleting data.
- Account/route cancellation and generation checks prevent late A responses from replacing B. Expired sync returns to a visible restore action; changed server consent policy requires a new grant. UI failures are localized and do not expose provider bodies or enumerate accounts.
- Backend migrations `0002_normal_owner_sync.sql` and `0003_normal_declaration_versions.sql` are additive source-only rollouts. They preserve synthetic contracts while permitting mode-aware normal accounts, learners, declaration versions and consent. They were applied only to newly created disposable test databases, never to an existing runtime database.
- Normal API access is authoritative for persisted account/profile mode. Envelope mismatches, readiness rollback, foreign owners, stale consent versions, synthetic/normal crossings, unapproved/draft/unknown items and provenance mismatches fail closed. Lab quarantine and `@example.invalid` guards remain unchanged.
- No normal Google CTA exists. Lab shows a noninteractive explanation instead of a disabled Google button. No child self-registration or automatic learner upload was added.

## Current hard blockers

1. **SMTP and real inbox:** the Brevo sender is verified and phone verification is complete. The approved private SMTP key handoff/configuration and authorized GoTrue restart, followed by real confirmation/reset tests, remain pending. Current GoTrue still uses Mailpit; real-inbox signup → confirmation → login has not run and must not be inferred from unit/fixture tests.
2. **Approved public route:** no stable owner-approved real-user API/auth origin is configured for this client. The temporary synthetic gateway and `@example.invalid` restriction are not a normal release backend. Do not point this client at Mailpit or relax that gateway.
3. **Policy and reviewed content:** exact owner declaration/sync-policy versions and privacy/guardian/deletion/retention decisions remain owner/legal approvals. The app invents none. All 73 bundled packs / 3,162 native items (including Arabic's 17) are draft; therefore normal release sync currently has no approved curriculum and must stay disabled. No content was approved by this work.
4. **Rollout approval:** production SQL migration, runtime-role/grant review, registry generation/provenance, backend restart and stable issuer/JWKS configuration require the infrastructure owner. No service was restarted or deployed here.
5. **Release/device proof:** the evidence APKs are local-only. Production release is unsigned; debug uses the ordinary local debug signing path. There is no production signing approval, physical-device test, real account, real email or live learner/sync E2E.

## Exact configuration contract (values intentionally absent)

The canonical origin is the same HTTPS origin for GoTrue issuer and API gateway. It must have lowercase host, no userinfo, path, query or fragment. Auth uses `/signup`, `/token`, `/verify`, `/resend`, `/recover`, `/user`, `/logout`; native API uses `/v1/account`, `/v1/learners`, `/v1/packs` and learner consent/events. Normal release permits HTTPS only; test loopback exceptions were not added to normal configuration.

Android build properties (normally local CI/build-machine properties, never secrets committed):

```text
umar.normalAuth.approved=false
umar.normalAuth.publicOrigin=
umar.normalAuth.syncPolicyVersion=
umar.normalAuth.ownerDeclarationVersion=
umar.normalAuth.registrySourceCommit=
```

Set `approved=true` only after all five values are deliberately populated and the gates in this record pass. Origin changes get separate credential/queue namespaces. Registry/proof changes are validated by pack proof, catalog and version checks; they do not create a separate credential namespace. The registry source is the exact 40-hex source commit whose approved pack/rules hashes the backend serves.

Backend environment contract (infrastructure owner supplies values; no credentials are embedded here):

```text
UMAR_DATA_MODE=NORMAL_ONLY
UMAR_NORMAL_RELEASE_READY=false
UMAR_NORMAL_DECLARATION_VERSION=
UMAR_NORMAL_SYNC_POLICY_VERSION=
UMAR_PUBLIC_ORIGIN=
UMAR_OIDC_ISSUER=
UMAR_OIDC_JWKS_URL=
```

When readiness is exactly `true`, declaration and sync versions must be the exact approved non-synthetic versions and match the Android build. Existing GoTrue ES256 issuer/subject verification remains authoritative; there is no shared identity database and no provider security change. Normal declaration version is persisted and idempotent activation rejects silent mode/version conversion.

## Minimal batched owner/infrastructure prerequisites

1. The sender is verified and phone verification is complete. Approve the private SMTP key handoff method, then have the infrastructure owner configure GoTrue SMTP host/port/username/sender through the approved private secret process and restart only the authorized target. Keep signup enabled, external email enabled, autoconfirm disabled and minimum password length 12. Do not reuse Mailpit or test credentials. Real confirmation/reset tests remain required afterward.
2. Provision a stable canonical HTTPS gateway/origin for GoTrue + Go API; set matching issuer and JWKS URLs, route only the documented normal contract, and allow the intended owner mailboxes. Remove reliance on the expiring synthetic tunnel without weakening its test guards.
3. Obtain the actual owner/legal decisions and version identifiers for the adult/guardian declaration, learning-sync consent, privacy/Data Safety, child/guardian handling, deletion and retention. Do not use placeholder text as a substitute. Review and apply SQL 0002/0003 plus runtime grants to the approved environment only after backup/rollout review.
4. Reviewer-approve the intended curriculum, regenerate the backend registry from that exact source, and verify approved pack/rules hashes and the Android registry source match. Until then, no real progress sync is permitted.
5. Run the approved live checklist with owner-controlled test mailboxes: register, actual inbox code, wrong-code denial, confirm, no pre-confirmation session, create/select an adult learner, complete native lessons, offline queue/retry/dedupe, process restart/token refresh, logout/relogin/restore, second-owner isolation, recovery/reset, and policy-version re-consent. Then review privacy/Data Safety and sign the release through the normal owner process.

## Google (separate, not implemented or enabled)

The owner must first approve and supply the Google Cloud project, Android OAuth client and any required web client for GoTrue, with basic identity scopes only (`openid`, `email`, `profile`). Configure GoTrue's Google provider through the infrastructure owner; no client secret belongs in Android. Implement and verify native PKCE with a pending-intent state fence and an exact app callback such as `id.petalytix.ayailmu://auth-callback/<state>`, plus the matching GoTrue redirect allowlist and package/signature registration. Do not reuse the syncLab callback. A Google CTA may appear only after that native flow and live verification are complete; the existing lab explanation is not a flow.

## Local verification evidence

Evidence is outside the repo at `.runtime/umar-integration/normal-auth-20261026/`. It includes red/green logs, test counts, final default-OFF production assemble/lint, disposable PostgreSQL integration, a dedicated Android 35 AVD cold start of the default-OFF debug APK, APK hashes and source manifests. These checks do not deliver email, approve content, activate a live endpoint or prove physical-device behavior.


## Completion addendum (review fixes verified 2026-10-26)

### Deployment and account/data modes

`UMAR_DATA_MODE` is mandatory for a normal deployment and has exactly two accepted values: `NORMAL_ONLY` or `SYNTHETIC_LAB`; unknown values fail startup. Normal readiness requires `NORMAL_ONLY`. A lab-mode process with normal readiness enabled is rejected. Normal-only rejects synthetic activation/envelopes/persisted owners and, while readiness is OFF, returns no lab/draft catalog. The separate legacy lab constructor retains synthetic behavior.

For a real deployment, `UMAR_PUBLIC_ORIGIN` and `UMAR_OIDC_ISSUER` must be the same canonical HTTPS origin as Android `umar.normalAuth.publicOrigin`. Verifier-only `UMAR_OIDC_JWKS_URL` may instead be a private HTTPS URL or an explicit loopback HTTP URL supported by `auth.validURL`. Keep JWKS private; do not open a public JWKS/admin route, allow arbitrary Docker-host plain HTTP, or expose the issuer/API over non-HTTPS transport.

### Restored ownership and local deletion

Room schema v3 adds only nonsecret `owner_profile_bindings` (profile ID, owner ID, environment hash). It is migrated atomically with profile rows and backed up with them, so restoring Room without the no-backup journal/vault cannot make owned adults or descendants local. Binding and ancestry reads use one Room transaction; refreshes are serialized and predicates remain IO-free. The same verified owner/environment may reselect its restored learner; foreign owners and unbound IDs cannot adopt it. Parent deletion propagates binding authority to surviving children.

Per-profile Settings deletion first cancels normal actions and removes that learner's local journal binding/history, then applies the existing guarded Room deletion. Surviving children are retained. Device-wide deletion cancels account actions and removes **all** designated `normal-owner-auth` and `normal-owner-sync` namespaces for current and previous origins, the retained engine state and vault before Room/settings/export reset. Any clear failure is reported. Long-lived objects remain usable for a later legitimate profile/account. Tokens are never backed up. Remote account/server data is not deleted by either operation.

### Parent SMTP contract — pending, not configured here

The Brevo sender is verified and phone verification is complete. Approval of the private SMTP key handoff method, followed by authorized configuration/restart and real confirmation/reset tests to the owner-controlled recipient, remains PENDING. No keys were read or created and no mail was sent.

After those approvals, the infrastructure owner supplies through its secret/config process:

```text
GOTRUE_SMTP_HOST=<approved SMTP host>
GOTRUE_SMTP_PORT=<approved SMTP port>
GOTRUE_SMTP_USER=<approved SMTP-only identity>
GOTRUE_SMTP_PASS=<secret, never committed>
GOTRUE_SMTP_ADMIN_EMAIL=<verified sender>
GOTRUE_SMTP_SENDER_NAME=<approved display name>
GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_DISABLE_SIGNUP=false
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_PASSWORD_MIN_LENGTH=12
```

These are configuration names only, not values or approval to restart. Names match the pinned official [GoTrue v2.197.0 SMTP configuration](https://raw.githubusercontent.com/supabase/auth/v2.197.0/internal/conf/configuration.go#L550-L568). Keep confirmation required. Run actual confirmation and reset tests before considering normal activation; Brevo sender verification alone is not live proof.

### Review-resolution checklist

- **FIXED + TESTED:** normal/lab deployment isolation; family/descendant and arbitrary-ID visibility guards; Room backup ownership and same-owner restore; retained flow/session-store revocation; serialized visibility publication and atomic relationship snapshots; fresh-password recovery; ordinary learner labels; operation-aware OTP/offline/429 errors; busy/Back and queued ViewModel fences; root auth without a spare profile; unconfirmed-code route; tester/prod store gates; capability-aware onboarding/Arabic consent/export/deletion copy; current+old-origin local cleanup; exact source manifest.
- **VERIFIED ON ACTUAL PROD FLAVOR:** default-OFF onboarding/Settings has no tester, raw learner ID or unconfigured store. Zero-local-profile root account CTA is visible/clickable. Create account, Sign in, Forgot password and inline validation have ordinary wording, one Back per level and no Google entry. The reserved-origin build is layout-only and NOT FOR RELEASE; no network submissions or mock sessions occurred.
- **OWNER/BLOCKED:** approved SMTP key/config/restart and real inbox tests; stable HTTPS origin/issuer/JWKS and normal gateway; owner/legal declaration/sync/privacy/guardian/retention/export/deletion decisions and matching published policy; approved curriculum/registry (all 73 packs/3,162 items remain draft); authorized SQL/runtime rollout; physical-device QA, live purchases, production signing and full live learner E2E.
