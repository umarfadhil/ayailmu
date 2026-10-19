# Continue with Google: local pilot setup (off by default)

Status: **off and not activated.** No Google client, secret, provider setting or proxy route was created or changed by
this slice. Every Google test in this repository runs the real `@supabase/auth-js` client against a *local fake*
Google/GoTrue; no real Google sign-in has ever been run. Everything below marked *future* needs explicit approval first.

## What the app does when a build turns it on

- **Flow:** Authorization code + PKCE (S256) through the local GoTrue's `/authorize`. The scopes are `openid email profile`,
  with `prompt=select_account`. The app never holds a Google client ID or secret; GoTrue does.
- **Callbacks:** The app accepts exactly one callback per platform:
  - web: `http://localhost:<page port>/account`, on the page's own loopback origin;
  - native: `arabictrial://account`.
- **What a callback must contain:** It is accepted once, only for the pending attempt, and only with one code that is a
  canonical lower-case UUID. Any token-like parameter (`access_token`, `refresh_token`, `provider_token`,
  `provider_refresh_token`, `id_token`, including percent-encoded names) is refused before anything is sent.
- **Pending attempt:** Only the SDK flow id, the PKCE verifier, the exact callback and the start time are kept, never a
  token. On the web they live in this tab's `sessionStorage` (one key, used once; a record the storage cannot remove is
  never used). On native they live in RAM.
- **After sign-in:** A Google sign-in goes through the same `GET /v1/me` verification and per-account dataset as the
  password sign-in. The panel shows only the account's email; the Google name and picture are never shown or stored.
  A Google identity is never consent: the adult profile, its consent and any guest copy stay explicit learner choices.

## App build settings (`EXPO_PUBLIC_*`, never secrets)

```sh
EXPO_PUBLIC_AUTH_PROVIDER=local-supabase
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8092
EXPO_PUBLIC_SUPABASE_AUTH_URL=http://127.0.0.1:<local Auth port>   # the Auth ROOT on loopback, never .../auth/v1
EXPO_PUBLIC_GOOGLE_SIGN_IN=on                                      # unset or anything else: Google stays off (default)
EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL=http://localhost:8081/account  # must equal the page's own origin + /account
EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL=arabictrial://account       # nothing else is accepted
```

The button («Lanjutkan dengan Google») appears only with all of the following:
- the local account service configured;
- `EXPO_PUBLIC_GOOGLE_SIGN_IN=on` and that platform's exact callback;
- a platform that can run the flow.

Expo Go is refused. Native also needs a development or standalone build with the system auth session
(`expo-web-browser`) and the runtime's own WebCrypto (`crypto.getRandomValues`, `crypto.subtle.digest`), plus `TextEncoder`
and `btoa`. No crypto shim is installed. Installing `expo-crypto` does **not** make Hermes provide WebCrypto, so native
Google sign-in is **not** claimed ready.

## Google Cloud (future, needs approval; not done)

- **OAuth client type:** **Web application**. GoTrue exchanges Google's code server-side.
- **Authorized redirect URI:** `<actual public Auth root>/callback`.
  - This standalone GoTrue serves its endpoints at its public transport root. That root differs from the logical JWT
    issuer ending `/auth/v1`, so do **not** use a managed-Supabase `/auth/v1/callback`.
  - The private `.test` TLS host cannot be registered as a Google redirect. It needs either an approved
    `http://localhost:<auth port>/callback` or a real public HTTPS domain.
- **Scopes:** `openid`, `email`, `profile` only.
- **Consent screen:** Testing status with explicit test users. This is staging hygiene only. For identity-only scopes,
  Google documents that Testing does not limit sign-in to the test-user list, so it is **not** the access boundary. The
  boundary is GoTrue's `disable_signup=true` plus pre-provisioned local identities.
- **Client secret:** server-only, in GoTrue's environment. Never in the app, an `EXPO_PUBLIC_*` value, or the repository.

## GoTrue and the TLS proxy (future, needs approval; not done)

Current state: Google is **disabled**, `disable_signup=true`, and the frozen TLS proxy answers GET `/authorize` and
GET `/callback` with **404**.

A future opt-in would set, with placeholders only:

```sh
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<google client id>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<server-only secret>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=<actual public Auth root>/callback
GOTRUE_URI_ALLOW_LIST=<exactly the app callbacks above; no wildcards>
GOTRUE_DISABLE_SIGNUP=true                      # unchanged
```

- **Proxy:** admit only `GET /authorize` and `GET /callback`, and keep every other deny exactly as it is. That needs its
  own reviewed deploy change.
- **Sign-up and linking:** with sign-up off, an unknown Google account is refused (`signup_disabled`), and the app says
  the account is not registered. Allowing first-time accounts is a separate policy decision: pre-provisioning, or a
  server-enforced enrollment restriction. Existing account and identity-linking behaviour is not changed here.
- **Flow-state expiry:** pinned GoTrue v2.197.0 keeps OAuth flow state for a default (and minimum) of 300 s from its
  creation. The app's own 10-minute record never extends that. After a slow consent the learner may be refused and
  should retry from the button. Do not raise the server expiry for this.
- **Forwarded parameters:** GoTrue forwards `prompt`, and its Google provider adds `email profile` to the requested
  scopes (per the pinned source). The real consent screen still needs a real end-to-end check.

## Known limits

- **Not activated:** no real Google, credentials or provider changes. Root still has to check the web URL, history and
  back/forward behaviour in a real browser.
- **Physical devices:** connectivity is unverified. The strict loopback guards (API on port 8092, Auth root on
  loopback) stay as they are.
- **Export and deletion:** the frozen backend accepts recent-auth export/deletion only with a password sign-in (AMR).
  An OAuth-only session cannot do them until a later, proper step-up slice. There is no `iat` fallback and no
  weakening.
- **Out of scope:** SMTP, password reset and account-deletion UI.
