# Session and recovery slice, 2026-10-20: D1 remembered password sign-in (native), then email recovery

Branch `feature/rn-session-recovery-20261020`, from the published RN head `6e4db69`. The backend stays read-only at
`09572af`. The 807 baseline cases and the 64 RN / 39 Go protected files stay byte-identical. Everything below is off by
default.

Status (2026-10-20, verified by Codex about 21:47–21:50 UTC):
- History: D1 RED (22 cases) ran as expected and is frozen. D1 GREEN passed Codex's run: 829/829 cases in 55 suites, typecheck and lint clean, with `expo-secure-store` 57.0.4 installed.
- History: the review RED ran as expected and is frozen: 840 cases in 57 suites, of which 835 pass and 5 fail. It added `src/auth/__tests__/supabaseAuthRemember.hardening.test.ts` (5 cases, all failing) and `src/auth/__tests__/sessionVault.test.ts` (6 cases, all passing). Review GREEN (a newer sign-in refused with `not_forgotten` when the vault cannot clear the record; the record bounded to 2048 UTF-8 bytes) then passed the 840-case checkpoint.
- **Now: 893/893 cases pass in 66 suites; typecheck and lint exit 0.** The 890 baseline case IDs and every protected original, D1 and recovery test and helper are byte-identical. The 893 include 5 transport body-deadline and 3 Google deadline regressions.
- Email recovery (below) is implemented, off by default. The frozen `AccountContext` recovery tests pass: with the flag off, no runtime or store call; the full request, link and update flow with secure fields; an own launch link handled first, with the pending Google attempt and the remembered vault untouched, guest bytes unchanged, the recovery session closed locally only, and no automatic account sign-in, account API call or dataset opening.
- Coordinator probes outside the app's tests (not part of the 893): actions 11, hook 11, config 10, web runtime 8, native runtime 7, error messages 19, form 4. Two integrated provider races pass: a late no-link launch result cannot start Google or the remembered restore after recovery began, and an explicit normal action fences a held recovery exchange, whose late session is retired locally.
- Offline Expo export passed for web, iOS and Android (Hermes bundles and assets complete), from the local uncommitted worktree on `6e4db69`. This is not native device proof.
- Fresh Chromium against the exported app, at 390×844 and 1280×800: guest smoke (7 checks) and recovery (9 checks) pass. Recovery runs the real maintained SDK with every Auth call answered by the frozen `fakeRecoveryApi`; no real API or external request is made. It covers: the verifier kept across a same-tab reload, `/recover` params removed, a one-use take, a mismatch sending no PUT, a weak password with a safe retry, success with only the own `scope=local` closure, no automatic sign-in or account API call, a replayed link making no provider call, and guest bytes unchanged. The one expected console message (the weak password's HTTP 422) is classified; there are no unexpected app errors. Fixes to the browser harness's header API and reporting changed no product code.

## D1: remember a password (email) sign-in on a native device

### Seams

| Seam | Contract |
| --- | --- |
| Build flag | `EXPO_PUBLIC_REMEMBER_DEVICE` exactly `on`. Without it, nothing is read, written or offered, and unmount still signs out. |
| `SupabaseAuthOptions.remember` | `{ vault: SessionVault }`, where `SessionVault = { installation(): string; read(): string \| null; write(text): void; clear(): void }`. The vault is synchronous and may throw. |
| `auth.remembered` | Present only with `remember`. `save(accountId): Promise<boolean>`, `restore(): Promise<{ identity, accountId } \| null>`, `release(): Promise<void>`. |
| `AccountProvider` | New prop `sessionVault?: SessionVault \| null`. The default is the platform vault when the flag is on; `null` turns the feature off. |
| `AccountPanel` | Checkbox `account-remember`, unchecked, in the password form only, labelled «Ingat sesi masuk dengan email dan kata sandi di perangkat ini» (no Google mention). Submitting adds `remember: boolean`. |

**Native vault (GREEN).**
- `src/auth/sessionVault.ts`:
  - The record lives in `expo-secure-store ~57.0.4`, using the synchronous `getItem`/`setItem` with `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` and `requireAuthentication: false`.
  - `clear` overwrites the record synchronously with a tombstone and never deletes it, because a late delete could erase a newer record saved under the same key. If that overwrite is refused, the marker is renewed, so the record left behind never matches again, and the refusal is still thrown.
  - The non-secret installation marker is created once in its own `expo-sqlite` database. It is not learner data or consent, and the native modules are loaded lazily.
- `src/auth/sessionVault.web.ts` returns `null`, so the web never stores a token.
- No other persistent store holds anything of the session.
- Codex installs the dependency. GREEN adds the `app.json` plugin entry only if the installed package's plugin options require it, for example for Android backup exclusion.

### Record (version 1)

The record is JSON with exactly these keys:

`{ v: 1, kind: 'password', installation, auth, api, profile: 'local'|'staging', uid, email, accountId, refreshToken, savedAt }`

- It never holds an access token or a password.
- `savedAt` is the time of the opt-in and is not renewed. The record is accepted only while `savedAt` is between 5 minutes in the future and 30 days in the past.
- The whole serialized record is at most 2048 UTF-8 bytes. This is checked before the text is parsed and before every write: save, refresh rotation and restore rotation.

### Behavior

- **`save`**
  - It needs the current password session (not Google, not ended or expired) and a canonical account ID, and it writes synchronously.
  - The controller calls it only after `GET /v1/me` has verified the account and the learner ticked the box.
  - A failed write returns `false` and is cleared on a best-effort basis. The panel then says «…tidak bisa diingat…», and the session stays an ordinary, unremembered one.
- **Rotation**
  - Every successful refresh of a remembered session rewrites only `refreshToken`.
  - The write happens synchronously, right after a check that this session is still the current one, not ended and still remembered.
- **`restore`**
  1. It starts a sign-in turn.
  2. It discards the record without any request, and clears the vault, on any mismatch: installation, Auth origin, API origin, profile, version, kind, age or shape.
  3. It presents the token once, through a fresh password client (`refreshSession({ refresh_token })`) and the bounded transport.
  4. The reply's user ID and email must match the record.
  5. It writes the rotated token back, then adopts the session.

  Its outcomes:
  - **unreachable:** `network`, and the record is kept;
  - **refused:** `expired`, and the record is cleared;
  - **mismatch:** `bad_response`, and the record is cleared and the fresh session revoked;
  - **overtaken:** `signed_out` or `superseded`, and the late session is revoked and never written back.
- **Controller after `restore`**
  - It runs the normal post-sign-in path, with the extra requirement that the verified account ID equals the record's.
  - It checks this **before** any dataset opens. On a mismatch it signs out, clears and revokes, and says «…tidak cocok…».
  - The guest copy, the adult profile and consent stay explicit learner choices.
- **Fencing**
  - `signIn`, Google `start()` and Google `resume()` first clear the vault synchronously, then drop any pending restore.
    - If the vault refuses, the sign-in is refused with `not_forgotten` before any grant, SDK client or PKCE attempt.
    - The session in use and its remembered record then stay as they were, and its refreshes still rewrite the record.
    - The account layer says «…belum bisa dihapus… Jadi masuk ini tidak dilanjutkan…». As after any failed sign-in, it then signs out a session still in use, through `signOut`.
  - `signOut` stops remembering at once and clears the vault as far as it allows. A failed clear returns `forgotten: false` and a fixed sign-out message («…sesi yang diingat belum bisa dihapus…»). It never claims the session was forgotten.
  - Unmount releases a remembered session without a logout (`release()`); otherwise it signs out exactly as today.
  - Google sessions stay RAM-only.

### RED files (run and frozen)

**`src/auth/__tests__/supabaseAuthRemember.test.ts`: 16 cases.** It uses the real SDK over the frozen fake GoTrue, with this suite's own fetch levers: hold a refresh, or lose its reply after the server rotated the token.

| Case | Covers |
| --- | --- |
| control (expected to **pass**) | No `remember` option: no remembered surface, unchanged sign-out |
| save | Exact record; refused before sign-in and for a non-UUID account |
| rotation | Refresh rewrites only the token; the spent token is refused |
| restore | One refresh grant, no password, API account confirmed, token rotated |
| discards (×8) | Installation, Auth origin, API origin, profile, older than 30 days, version, Google kind, non-record text |
| outage | Network keeps the record; a reply lost after rotation is not a restore; the next try is refused and clears |
| sign-out races | Sign-out during a restore, and during a refresh: cleared at once, late result revoked, nothing written back |
| newer sign-in | A password sign-in overtaking a restore, and Google `start()`, both clear the record |
| release | No logout, record kept, a new instance restores |

**Expected RED:** the 15 non-control cases fail at once with `Error: This adapter has no remembered-session surface (auth.remembered).`

**`src/ui/__tests__/AccountContext.remember.test.tsx`: 6 cases.** It runs the real provider stack. The `sessionVault` prop is supplied through a test-local cast of `AccountProvider`.

| Case | Covers | Expected RED |
| --- | --- | --- |
| control | Flag off: vault untouched, no choice, unmount signs out | **passes** |
| unchecked choice | Flag on: unchecked, email-only wording; unticked stores nothing and unmount signs out | fails at `getByTestId('account-remember')` |
| remembered flow | Save after `/v1/me`, release without logout, restore with one refresh and no password, choices still explicit | fails at pressing `account-remember` |
| API mismatch | Cleared, revoked, nothing opened | fails at a 5 s `waitFor` on «…tidak cocok…» |
| explicit sign-out | Cleared and revoked; the next run restores nothing | fails at a 5 s `waitFor` on signed-in |
| unavailable vault | `null` vault offers no choice; a failing write reports and signs out as before | fails at pressing `account-remember` |

**Expected totals:** 829 cases in 55 suites, of which 809 pass and 20 fail. Typecheck should be clean, because the future seams are only reached through test-local types and casts.

**Not in this RED: a native vault unit suite.** The native module and `expo-secure-store` don't exist yet. A suite that requires them risks a missing-module error or a lint error from the unresolved import, instead of an ordinary failure. If Codex wants one before GREEN: a small follow-up RED against a dependency-injected `createSessionVault({ secureStore, marker, newId })`, plus the web `null` guard. The review RED has since added it as `src/auth/__tests__/sessionVault.test.ts`.

## Email recovery (implemented, off by default)

- **Flag:** `EXPO_PUBLIC_PASSWORD_RECOVERY` exactly `on`. Without it, no recovery runtime, store or option is touched or offered.
- **Callbacks:** native `arabictrial://recover`, which needs a standalone build with the app's own scheme (Expo Go is unsupported, so recovery stays off there); on the web, the app's own origin with `/recover`, a route that replaces itself with its bare path.
- **Link:** strict PKCE. A callback is exactly the configured one with one canonical lowercase UUID `code` and nothing else; anything else is refused before any client is built or anything is sent.
- **Pending attempt:** one use, bounded verifier metadata only (7 keys, at most 2048 UTF-8 bytes): in RAM on native while the app stays open, in the same tab's `sessionStorage` on the web. No email, password or session token is persisted.
- **Request:** a successful request (including the cooldown result) shows the same «Jika alamat ini terdaftar…» text, never a promise of delivery or an account-existence result. Validation or connectivity failures show fixed safe messages. The `.test` address rule and the 60-second cooldown apply.
- **Recovery session:** held privately, only to change the password through `updateUser`. It is never adopted as the normal sign-in or handed to the account API, and is retired with a local sign-out only (no `scope: 'others'`, no global revocation). The copy says when that closure was not confirmed, and that the outcome is unknown when the server could not be reached during the change; a weak password stays retryable.
- **Fencing:** an own launch link is classified before the Google callback or a remembered sign-in may resume, and blocks both. Their pending records stay untouched, and leaving a run that only recovered leaves the Auth adapter alone. An explicit normal sign-in or sign-out ends recovery, and older launch or foreground links cannot reopen it.
- Guest copy, consent, adult-profile choices and refresh-before-sync are unchanged.

## Remaining boundaries

- This is a locally verified implementation. Real Auth, mail delivery, the redirect allow-list, server password policy and native Keychain/Keystore behavior are not proven.
- SMTP or a mail catcher, the redirect allow-list, the staging address policy and server password policy remain user or external decisions.
- Native device validation (vault persistence, reinstall, the recovery scheme) needs full Xcode or an Android SDK on this machine.
- Durable web sessions are out of scope.
- Nothing was published, deployed, committed or pushed, and no credentials, services, real email or token renewal were used.
