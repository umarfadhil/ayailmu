# Production client profile: code checkpoint

Status: a client code checkpoint for reviewers, not a deployment or release approval. Nothing was deployed, no hosting
or credentials were bought or configured, and no real email was sent.

## What turns it on

Account sync stays off unless all of these hold (`app/src/account/supabaseConfig.ts`):

- `EXPO_PUBLIC_AUTH_PROVIDER=local-supabase`: a kept legacy name for a standalone, self-hosted GoTrue whose endpoints
  are at the root of its own origin, never a hosted `/auth/v1` prefix.
- `EXPO_PUBLIC_ACCOUNT_ENV=production` **and** `EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on`, both exact. Neither alone turns
  production on, and the flag changes nothing in a local or staging build.
- `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_SUPABASE_AUTH_URL`: two distinct strict canonical HTTPS root origins of
  public DNS names (no path, port, userinfo, query, fragment, IP literal, local or test name).

Public placeholder example (fictional hosts; these values are public build settings, never secrets):

```sh
EXPO_PUBLIC_AUTH_PROVIDER=local-supabase
EXPO_PUBLIC_ACCOUNT_ENV=production
EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on
EXPO_PUBLIC_API_BASE_URL=https://api.example.org
EXPO_PUBLIC_SUPABASE_AUTH_URL=https://auth.example.org
# In this checkpoint leave EXPO_PUBLIC_GOOGLE_SIGN_IN and the remembered-session and password-recovery opt-ins unset (off).
```

The API client and the Auth adapter revalidate the same rules themselves; the adapter keeps the origins and the profile
it validated when it was built.

## What the client does in this profile

- Password sign-in accepts an address by its conventional ASCII email format only, never as a deliverability check.
  Local and staging builds keep their synthetic `.test` restriction unchanged.
- Sign-up stays off: only prepared, existing accounts can sign in.
- Guest data is copied, and a profile is created or chosen, only by the learner's explicit action. The existing manual
  sync and refresh rules are unchanged.
- An adult profile records `draft-production-account-sync-consent-0.1`, distinct from the local and staging versions.
  It is an UNREVIEWED draft consent for server storage: owner and privacy approval is required before any real release,
  and neither this commit nor the flag is that approval.
- Draft curriculum gating and guest behaviour are unchanged; no content is approved by this work.

## Not finished in this checkpoint

- Remembered password sessions: the native core is bound to the installation, Auth server, API and production profile,
  and rotates its refresh token on restore, but proof on a physical device is pending. Web has no token vault.
- Production Google sign-in is unfinished: keep it off.
- Password recovery has a guarded production code implementation. On native, the pending attempt (its PKCE verifier) is
  kept in the OS secure store under its own item, bound to the installation, API, Auth root and callback, at most 2048
  bytes and 60 minutes; on web it stays in same-tab sessionStorage. Proof with the real native crypto, OS, devices and
  mail is still pending, so the example above and any release keep recovery off.
- Settings export and deletion are separate, unfinished work; the Settings screen's inherited local wording is to be
  corrected in that slice.
- The backend currently admits only its explicitly configured staging deployment, so nothing serves this production
  mode yet. The client opt-in changes no backend or live resource.

## Remaining release gates

- The intended auth/database organisation and hosting choice.
- Reviewed consent, privacy, support and retention texts.
- SMTP, and real disposable-account sign-up, verification and reset once enrolment is approved.
- Secure recovery on a supported native runtime, and lifecycle tests on real devices.
- Server and client export and deletion, completed.
- Final bundle identities, signing and device checks.
- Backups with a tested restore, and probes against the real services.

## Evidence so far

Every production test runs in memory: the real SDK, adapter, API client and app layers against the frozen fake servers
(`app/test/fakeAccountApi.ts`) through `app/test/productionNetwork.ts`, with fictional `example.org` hosts. None of it is
evidence about a real service or device; there is no such evidence yet. The production tests, under `app/src/`:

- `account/__tests__/productionConfig.test.ts`, `account/__tests__/productionGuards.test.ts`
- `auth/__tests__/productionTransport.test.ts`, `productionEmail.test.ts`, `productionEmailGuards.test.ts`,
  `productionRemember.test.ts`, `productionRememberRestore.test.ts`, `productionProfileBinding.test.ts`
- `ui/__tests__/AccountContext.production.test.tsx`, `ui/__tests__/AccountContext.productionConsent.test.tsx`
- `ui/account/__tests__/AccountPanel.production.test.tsx`

Validation, run from `app/` (this document records no result):

```sh
npm test -- --runInBand
npm run typecheck
npm run lint
```
