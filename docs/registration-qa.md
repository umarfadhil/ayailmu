# Registration QA (operator-assisted)

QA guide for synthetic `.test` registration with required email confirmation. Design and status:
`docs/superpowers/plans/2026-10-25-registration-confirmation.md`. Final verification is still in progress; this guide
does not claim phone, device, store or production readiness.

## Build settings

- `EXPO_PUBLIC_ACCOUNT_REGISTRATION=on` only in local or staging builds that have been validated against local
  Supabase. Default is off; production is always off.
- `EXPO_PUBLIC_PRODUCTION_ACCOUNTS=off`.
- Do not enable the existing PKCE password recovery.
- No keys (anon, service, admin) in any `EXPO_PUBLIC_*` value.
- Staging API and Auth roots are the approved current HTTPS roots from the operator handoff (they may be the same
  root); `https://<staging-api-root>` and `https://<staging-auth-root>` are placeholders. A temporary approved HTTPS QA
  endpoint is allowed. Never commit temporary endpoints, user-specific paths or keys into app source.
- The GoTrue root has no `/auth/v1` suffix unless that is explicitly the actual deployment root (not the logical
  issuer).

## Runtime

- Expo SDK 58: use a matching Expo Go 58 or a native build. A tunnel does not fix an SDK mismatch.
- Browser: the gateway answers the CORS preflight with 404. Do not disable browser security or modify the gateway to
  work around it. Native fetch behaves differently, but a physical-device test is still pending.
- The gateway excludes export/deletion on purpose; that is not a missing feature.

## Test flow

Use a fresh synthetic `.test` address each run.

1. Sign up with email and password. Expect “confirmation required”, never “email sent”.
2. The operator reads the code from the private Mailpit and passes it on out of band.
3. Resend the code; enter a wrong code and expect a retryable error.
4. Confirm with the correct code. Expect a prompt to sign in; you are not signed in yet.
5. Sign in separately with the email and password.
6. Make the explicit choice: adult profile or guest.
7. Complete a lesson and check that it syncs.
8. Log out; confirm the account's data is not visible to the guest or to another account.

Also check:

- Cancel, blur, backgrounding the app and leaving the screen each stop the flow under way.
- Returning via “Sudah punya kode” requires re-entering the email; no password or code is kept.

## Evidence so far

Historical, SDK 57 at `754129f`:

- Adapter against real GoTrue with a private Mailpit: 16 checks PASS.
- Real SDK over in-memory fetch: 11 checks PASS.
- Fresh root run: 1305 tests in 144 suites PASS; typecheck PASS; lint 0 errors, 2 pre-existing warnings.
- Independent review: CLEAR (17 lifecycle/route/Context tests plus actual React callback probes).

SDK 58 checks:

- Typecheck PASS; lint 0 errors, 2 pre-existing warnings; Expo dependency check PASS; Expo Doctor 20/20 PASS.
- Live local QA: 23 checks PASS, including in-memory session restore.
- Full Jest suite is rerun by the root with the SDK 58 Jest asset-registry setup.

- UI: unit tests only. Not verified in a backend-connected browser or on a physical device.
- Native JS exports and a local shared-code browser smoke/build are prerequisite checks only; they never prove
  physical-device or store readiness.

No real SMTP or inbox delivery has been tested. No device or store build has been verified.

## Data handling

- Never publish or paste Mailpit, admin or database access, passwords, codes (OTP) or tokens. Do not record
  credentials in notes, tickets or screenshots.
- Keep all synthetic accounts. Cleanup needs separate approval.

## Publication

The current public `a04873b` guest preview is not updated by this work. Publishing this code or a connected preview
needs a separate approved payload.
