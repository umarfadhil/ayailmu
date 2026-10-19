# GoTrue migration and mobile account flow

User decision: standardize Umar on maintained self-hosted Supabase Auth/GoTrue.
Published integration checkpoint is `3b4f2064103fe6514c314b9e9b60adcf6c9479ff`.
Implement follow-up commits locally, one Codex writer; no further push/deployment.

## Current inventory and missing flows

Only Android Kotlin/Compose syncLab is integrated. Demo/prod retain the ordinary
local graph. There are no Swift files/Xcode targets, and the Expo prototype is
unchanged. Current lab has browser sign-in, synthetic learner create/select,
manual consent/sync, offline learning, local logout and re-login on expiry.
Missing: in-app email/password login, signup/confirmation, recovery/password reset,
account/settings navigation, secure session restore/refresh, and prepared Google
login. No public signup, email login, confirmation, reset, SMTP or social provider
is currently enabled in the two existing Keycloak realms. Test administrators mark
fabricated users email-verified; this is not real email delivery.

`~/work/memvios-mobile` is unavailable on this Mac; bounded local/project searches
found no copy. Its actual stack/UX is unverified pending an exact accessible path.
No proprietary code/assets will be copied or uploaded, and Umar's framework will
not be rewritten based on an assumed reference.

## Architecture and preservation

Use GoTrue v2.197.0 pinned to its image digest. Keep Umar's existing app database
and immutable event/learner tables. Identity uses a new dedicated Postgres volume,
separate from Amar and Keycloak. Preserve the old Keycloak Compose definition,
containers and volumes. Never link identities by email or rewrite historical
issuer/subject ownership: new GoTrue users are distinct; old synthetic records
remain intact under their original identity. No destructive migration.

Add a GoTrue verifier mode to the Go API using maintained go-oidc/go-jose key
verification, pinned issuer/audience/ES256 JWKS, authenticated role, UUID subject
and session, and rejection of anonymous/service tokens. Signed AMR authentication
timestamps determine freshness; token refresh's `iat` must not count as a new
login. Keep the legacy verifier for historical smoke/regression coverage. Add a
read-only account endpoint for verified same-owner session restoration/refresh.

GoTrue will bind loopback8287; the new API loopback8187; existing app DB6586 is
retained. Existing Keycloak8286/API8186 remain untouched. A local Mailpit SMTP sink
and UI8387 deliver only fabricated test mail, with confirmation required and
autoconfirm off. No real SMTP provider or Google credentials are configured.

Android retains Compose/Hilt/Room and unchanged native learning algorithms. Use a
small tested adapter to GoTrue's documented HTTP API; the current stable Kotlin
SDK3.8 requires Kotlin2.4 while this app is pinned to2.2.20, so a whole-app compiler
upgrade is outside this migration. GoTrue owns password hashing, OTP issuance,
OAuth verification and session rotation. AppAuth's maintained PKCE helper and
Google Tink/Android Keystore protect OAuth/session material; no custom cryptography
or client-issued authentication tokens. Authentication data must never be logged.

## Mobile behavior

Provide sign-in, create account, confirmation-code, forgot/reset-password and
account/settings screens with ID/EN strings. The lab accepts only fabricated
`@example.invalid` adult identities; no real child/adult data switch. OTP confirmation
and recovery exercise actual GoTrue and local mail delivery. Account settings show
the current fabricated account, selected owned learner, local learning preferences,
sync state/withdrawal and logout; no cross-owner profile picker.

Encrypt persisted sessions with Tink and Android Keystore in no-backup storage.
Restore and refresh through the real provider, serialize refresh-token rotation,
and fence late responses on login/logout/account switch. Network failure keeps
offline native learning and the scoped outbox; revoked/invalid refresh requires
sign-in. Fresh authentication remains required for sensitive server operations.
Logout clears local credentials/selection immediately and attempts provider logout;
offline logout cannot promise immediate remote revocation of already-issued tokens.

Google support remains disabled by default. Prepare exact provider environment
template, native Continue with Google action, PKCE callback binding, cancellation,
replay/expiry and session handling. Google only authenticates with GoTrue, whose
tokens the API verifies; Google tokens are never accepted as API credentials.
No project/client creation, credential configuration or permission grant happens
without action-time approval. Local callback: `http://127.0.0.1:8287/callback`;
deployed callback: `https://<umar-auth-host>/callback`; native return:
`id.petalytix.ayailmu.synclab://auth-callback`. Request only identity scopes,
never Gmail/mailbox access. Actual Google login remains unverified until approved
credentials exist; prepared UI must say setup is required.

## Verification

Run failing-to-passing verifier/HTTP/session/callback tests, Go race/Postgres tests,
real GoTrue signup/confirmation/login/refresh/recovery/logout tests through local
Mailpit, native offline/retry/second-client/ownership tests, and Android build/Room
regressions. Use a disposable Android35 emulator for available UI/browser tests.
Inspect the four existing backup/export lint errors without redesigning their
unchanged files. Record platform coverage and credential/path blockers exactly.
