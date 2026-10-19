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
   code to `completeGoogle(state, code)`.
6. Verify on the disposable emulator before any real account is allowed:
   cancelled intent, expired intent, replayed callback, and wrong state must all
   fail closed; a successful exchange must land in the same Tink/Keystore vault
   and owner-scoped sync as email/password sign-in.

## Current limits

- Live Google login is unverified and blocked on missing provider credentials.
- The prepared app path is synthetic-only; no real Google account may be used
  until the coordinator approves credentials and the emulator verification in
  step 6 is recorded.


## Tracked follow-up after WIP publication

Google/Gmail-account sign-in remains an explicit open deliverable. It is not
completed by the synthetic GoTrue tests or by publishing the integration draft.
First close the [Important account/learning findings](2026-10-19-wip-checkpoint.md).
The native Google button still has no launch handler, and the syncLab manifest
still has no Google return intent filter. Prepared helpers are not an end-to-end
implementation.

Read-only inspection on 19 October: the installed Google CLI's selected context
belongs to an unrelated work project. A filtered list of accessible projects with
Umar/AyaIlmu names/IDs returned no entries. No suitable owner/project is confirmed.
No account switch, login, client/secret inspection, project creation, IAM change,
provider enabling or cloud billing change was performed. Unrelated account details
are deliberately omitted from repository evidence.

### Decisions needed before setup

- Identify the Google account that owns Umar's app and select a specific approved
  project, or approve creating a separate Umar project. Do not default to the
  current work project or reuse Amar's client, secret, identity database or grants.
- Choose the branding/support contact and an External/Testing audience appropriate
  for the intended adult testers. Name the approved adult test Google identity.
  A real Google sign-in shares that tester's basic Google identity with Umar's
  local auth service, even when every learner/answer remains fabricated.
- Confirm local pilot only, with callback `http://127.0.0.1:8287/callback`. Any
  later public callback needs a separately approved exact HTTPS Umar auth hostname;
  there is no deployed hostname selected or deployment authorization here.

### Concrete actions requiring action-time approval

1. In the selected project, configure Umar's OAuth branding/audience/data access
   and create a new **Web application** OAuth client (proposed label:
   `Umar AyaIlmu local pilot`). Register only the exact approved callback above.
   Use `openid`, `email`, `profile`; Gmail/mailbox, Drive and other API access are
   outside the request. No Android client is needed for this browser-to-GoTrue
   code exchange.
2. Persist that new client ID/secret only in Umar's ignored local secret storage
   and configure only the isolated GoTrue provider. Client secret must never enter
   the APK, Git history, PR, screenshots or chat. Approval must cover persistent
   credential creation and this exact destination. Preserve all other stacks.
3. After callback implementation and regression repairs, approve the named adult
   tester's live Google grant of basic identity to this Umar client. Verify the
   consent screen's app/account/scopes at the actual grant; no mailbox access.
   No real child profile or learner history is permitted in this pilot.

GoTrue configuration for that approved pilot is the four `GOTRUE_EXTERNAL_GOOGLE_*`
settings listed above. Google redirects to GoTrue, and the app receives only the
PKCE code via `id.petalytix.ayailmu.synclab://auth-callback/<state>`. Implement
browser/Custom Tab launch, strict scheme/host/single-state-path parsing and
`completeGoogle(state, code)`, including errors/cancellation. Validate the pinned
GoTrue version's actual redirect behavior: its documented `SITE_URL` same-host
rule can permit more than an exact allow-list entry. Do not assume the existing
base-only configuration enforces the intended state path. App validation and a
real redirect test must reject malformed/wrong/replayed returns.

### Required live verification before calling this complete

On the disposable emulator: new Google login creates/resumes only the verified
Umar owner; a second approved adult Google identity cannot read/select the first
owner's learners; cold restore and actual token refresh work; local logout works;
Back/cancel, replay, wrong state, expired intent and cancellation after engine
commit leave the correct account state. Learning/sync continues with fabricated
profiles/events only. Record real provider evidence separately from unit fakes.

The current limitations are **pending selection/approval and implementation**,
not a denied action. No persistent Google setup or live grant was attempted.

Official references checked for this checklist:

- [Supabase Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google): web client, identity scopes and provider callback.
- [Google server OAuth requirements](https://developers.google.com/identity/protocols/oauth2/web-server): exact redirect matching and loopback exception for local development.
- [Supabase mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking): native return routing.
- [Pinned self-hosted Auth configuration](https://github.com/supabase/auth/blob/v2.197.0/README.md): provider environment settings and redirect matching behavior.
