# Google sign-in preparation (disabled)

Status on 2026-10-19: **prepared in code, disabled in configuration, unverified**.
`GOTRUE_EXTERNAL_GOOGLE_ENABLED=false` in `integration/gotrue.compose.yaml`. This
task created and configured no Google Cloud project, OAuth client, credential or
grant for Umar; any pre-existing Google resources owned by others are untouched
and unknown to this checkpoint. Enabling Google sign-in requires action-time
approval and explicit credential configuration; none of that happened here.

## What is already prepared

- `GoTrueAuth.googleUrl(challenge, redirect)` builds GoTrue's documented
  `/authorize?provider=google&redirect_to=…&code_challenge=…&code_challenge_method=s256`
  request. Covered by `GoTrueAuthTest` and `SyncLabAccountTest`.
- `SyncLabAccount.beginGoogle()` generates an AppAuth `CodeVerifierUtil` PKCE
  pair, binds a random state into the native return path, and stores a one-shot
  pending intent (verifier + state + account generation + creation time).
  `completeGoogle(state, code)` validates all of that before exchanging:
  a wrong state/path, a replay, a cancelled or superseded intent (any
  login/logout/account change invalidates the generation), an intent older than
  ten minutes, or a device clock rolled back past creation all fail closed with
  no code exchange. Only a fully matching pending intent reaches the PKCE grant.
  A disabled button alone is not the validation; the helper path above is, and
  it is unit-tested without any Google credential.
- The lab UI shows a **disabled** "Continue with Google — setup required"
  action (`sync_lab_google_disabled`). It cannot be tapped.
- Unit coverage: `googlePreparationFailsClosedUntilSetupApproved` and
  `googlePreparationUsesAppAuthPkceAndStaysDisabledWithoutSetup`.

## Exact URLs

| Piece | Value |
| --- | --- |
| Local GoTrue callback | `http://127.0.0.1:8287/callback` |
| Deployed GoTrue callback | `https://<umar-auth-host>/callback` |
| Native return (allow-listed base) | `id.petalytix.ayailmu.synclab://auth-callback` |

Google never talks to the app directly. The browser finishes Google's OAuth at
GoTrue's `/callback`; GoTrue then redirects to the allow-listed native scheme
with the authorization code — the app uses one nonce path segment
(`id.petalytix.ayailmu.synclab://auth-callback/<state>`) and rejects anything
else — and the app exchanges the code for GoTrue tokens. Google tokens are
never accepted as Umar API credentials; the API verifies only GoTrue-issued
ES256 sessions (`backend-umar/internal/auth/gotrue.go`).

A future enabled configuration must pin the allow-list to the exact approved
host/path pattern (`id.petalytix.ayailmu.synclab://auth-callback` with a single
nonce segment), never an unrestricted scheme-wide match, and the deployed
callback must be exactly `https://<umar-auth-host>/callback` on the approved
Umar auth host.

## Approval-time setup checklist (not performed)

1. Approve creating/using a Google Cloud project for Umar (action-time
   decision; no project was created in this checkpoint).
2. Configure the OAuth consent screen: app name, support email, **identity
   scopes only** (`openid email profile`). Never request Gmail/mailbox scopes.
3. Create an OAuth client of type **Web application** (GoTrue exchanges the
   code server-side; no Android client ID is needed). Authorized redirect URI:
   `<API_EXTERNAL_URL>/callback` (deployed) or `http://127.0.0.1:8287/callback`
   (local synthetic testing only).
4. Set GoTrue configuration: `GOTRUE_EXTERNAL_GOOGLE_ENABLED=true`,
   `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`, `GOTRUE_EXTERNAL_GOOGLE_SECRET`,
   `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=<API_EXTERNAL_URL>/callback`.
   Keep `GOTRUE_URI_ALLOW_LIST` limited to the native return scheme.
5. App-side enabling: enable the lab button, open `beginGoogle()`'s URL in a
   browser/Custom Tab, add the `id.petalytix.ayailmu.synclab://auth-callback`
   intent filter, match the returned state with `googleState()`, and pass the
   code to `completeGoogle(code)`.
6. Verify on the disposable emulator before any real account is allowed:
   cancelled intent, expired intent, replayed callback, and wrong state must all
   fail closed; a successful exchange must land in the same Tink/Keystore vault
   and owner-scoped sync as email/password sign-in.

## Current limits

- Live Google login is unverified and blocked on missing provider credentials.
- The prepared app path is synthetic-only; no real Google account may be used
  until the coordinator approves credentials and the emulator verification in
  step 6 is recorded.
