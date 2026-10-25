# Registration with required email confirmation — plan (2026-10-25)

Branch `feature/registration-confirmation-20261025` from `a04873b`.
Scope: synthetic `.test` sign-up, confirmation code, resend, error/retry/cancel/logout against standalone GoTrue in
local and staging only. Email confirmation stays required. No real-email enrollment, no production registration, no
SMTP change (inbox delivery stays blocked on separate SMTP approval). The current public preview is unchanged.
QA steps: `docs/registration-qa.md`.

## Status

Implemented; final verification in progress (results not yet recorded here).

- **Adapter** — `app/src/auth/registration.ts`.
- **Controller** — `app/src/ui/account/registrationController.ts`.
- **Panel** — `app/src/ui/account/RegistrationPanel.tsx`, inside `AccountPanel`.
- **Hook** — `app/src/ui/useAccountRegistration.ts`.
- **Context / route** — `app/src/ui/AccountContext.tsx`, `app/src/app/account.tsx`. Shown only when
  `EXPO_PUBLIC_ACCOUNT_REGISTRATION` is exactly `on` in a local or staging build; off by default, always off in
  production.

The 150 existing baseline test/helper files stay protected (unchanged). One fixture in a new test file was corrected;
all of its assertions were preserved.

## Recorded evidence so far

- Adapter against real GoTrue with a private Mailpit: 16 checks PASS.
- Real SDK (`@supabase/auth-js` 2.118.0, pinned) over in-memory fetch: 11 checks PASS.
- UI behaviour is proven by unit tests only, not in a live browser or on a phone.

## Adapter contract (`@/auth/registration`)

```ts
type RegistrationSdkClient = Pick<GoTrueClient, 'signUp' | 'verifyOtp' | 'resend' | 'signOut' | 'stopAutoRefresh'>;
createRegistration({ config: EnabledSupabaseConfig, createClient?, fetch?, now?, timeoutMs? }): Registration
interface Registration {
  register(email, password): Promise<{ status: 'confirmation_required' }>;
  confirm(email, code): Promise<{ status: 'confirmed'; signInRequired: true }>;
  resend(email): Promise<{ status: 'resent' }>;
  cancel(): Promise<void>;   // drops the attempt under way; the registration stays usable
  dispose(): Promise<void>;  // drops it and refuses every later call
}
class RegistrationError extends Error { code: RegistrationErrorCode }
type RegistrationErrorCode = 'not_synthetic' | 'invalid_code' | 'weak_password' | 'rate_limited' | 'network'
  | 'auto_confirm_refused' | 'provider_refused' | 'bad_response' | 'cancelled' | 'superseded' | 'disposed';
```

Rules:

- **Config.** Revalidated once with `accountApiOrigin`/`accountAuthOrigin` (local loopback, or staging root origins).
  A disabled, legacy, unknown-profile, unsafe or **production** configuration throws at construction: no client, no
  fetch.
- **SDK client.** One fresh client per call: `url` = the Auth root, unique `storageKey`, `persistSession: false`,
  `autoRefreshToken: false`, `detectSessionInUrl: false`, `debug: false`, `fetch` = the bounded transport (refuses any
  address outside the Auth root without calling fetch). No API/admin key, no `pkce` flow, no storage. Each client is
  retired after its call (`stopAutoRefresh()`). `timeoutMs` is bounded to at most `AUTH_REQUEST_TIMEOUT_MS`.
- **Input.** Only a `.test` address, else `not_synthetic` with nothing built. Email and password are sent exactly as
  given, once. A code is 6–10 digits, else `invalid_code` before anything is sent.
- **register.** `signUp({ email, password })` exactly. Accepted only when the reply carries a canonical UUID user whose
  email matches and a null session → `confirmation_required` (the expected normal sign-up reply). Malformed replies
  (missing, non-canonical or mismatched user) are rejected (`bad_response`). An auto-generated session (autoconfirm misconfiguration) is refused with `auto_confirm_refused`
  and retired; it is never adopted or reported as signed in. Outcomes never reveal whether an address exists.
- **confirm.** `verifyOtp({ email, token, type: 'signup' })` exactly. Accepted only with a canonical, matching,
  token-bearing session and a consistent user. A user-only confirmation reply without a session, or any malformed or
  unverified one, is refused (`bad_response`). That temporary session is retired with `signOut({ scope: 'local' })`
  and never handed out; `signInWithPassword` is never called. An explicit password sign-in is required afterwards.
- **resend.** `resend({ email, type: 'signup' })` exactly; resolves `resent`, never “email sent”.
- **Authorization.** No request carries `apikey` or `Authorization`, with one exception: the logout that retires the
  adapter's own ephemeral confirmation session. The normal account session is never touched.
- **Errors.** Mapped from SDK error class/code only, never server text: `weak_password`, `rate_limited`,
  `invalid_code`, `network`, `provider_refused`, `bad_response`. Messages and JSON never contain the password, code,
  token or server text.
- **Latest wins.** A newer call supersedes the one under way (`superseded`); `cancel()` → `cancelled`; `dispose()` →
  `disposed`. A stale client is stopped at once; a late session from it is retired, never adopted.
- **Isolation.** Nothing stored, logged, or put in a URL. Registration never opens the learner store or SQLite, never
  touches web storage, never reads or signs out the normal sign-in, so cancel/dispose cannot erase another account's or
  the guest's data. Only the five methods are exposed; no token-bearing member.

## UI rules

- Cancel, blur, backgrounding or unmount stops the flow under way.
- Returning via “Sudah punya kode” requires re-entering the email; no password or code is kept.
- Short Indonesian copy that never claims an email was delivered.
