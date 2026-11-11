# General-user profile: local configuration

Status: a local configuration assembly for reviewers, not a deployment, a public release or an approval. It creates no
service, backend, account, mailbox or signing identity, and its writer executed none of the commands below.

It points the existing production account path at normal email users. It adds no authentication code: the client, Auth
adapter and API client are the ones described in [PRODUCTION_PROFILE.md](PRODUCTION_PROFILE.md), whose sign-up-off,
unfinished-export and production-Google-unsupported statements this page supersedes.

## What the client does

- Sign-up: any user with a conventional email address and a password. There is no owner allowlist. The user enters the
  confirmation code, or asks for a resend, and then signs in with the normal email and password.
- Identity is the canonical one the API returns, and the datasets kept for an account are bound to that account.
- Guest data is copied into an account, and a profile is created or chosen, only by the learner's explicit action.
- Saved progress is stated truthfully: the account screens show only what has actually been saved.
- Optional secure memory (`EXPO_PUBLIC_REMEMBER_DEVICE`, `on` or `off`): on native the session is kept in the OS secure
  store, bound as described in PRODUCTION_PROFILE.md. Web has no token vault.
- Private QA is a separate path and is unchanged. This profile requires it to be off.

`production` in `EXPO_PUBLIC_ACCOUNT_ENV=production`, in `EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on` and in the `general-user`
recipe in `eas.json` names the existing normal-email runtime capability. It does not mean a public deployment or an
approved release.

## Configuration

- `plugins/withGeneralUser.js` is a pure validator, listed last in `app.json`. Unless `AYAFASIH_GENERAL_USER` is exactly
  `on` it changes nothing. When on, it requires the exact core settings in the example file (`REMEMBER_DEVICE`,
  `GOOGLE_SIGN_IN` and `PASSWORD_RECOVERY` may each be `on` or `off`, independently) and two distinct root origins on
  public DNS names, and its messages never repeat a value. It validates the enum values, the core profile and the roots.
  It does not validate platform availability.
- `profiles/general-user.env.example` is an inactive example, not loaded automatically and not a `.env` file. It holds
  no address, account, secret, key, certificate, native identifier or endpoint, and both origins are blank. The local copy
  `profiles/general-user.env.local` is git-ignored and has not been created.
- The `general-user` recipe in `eas.json` is inactive and was never run. It carries the same flags without any URL or
  identifier, to be supplied externally once approved. It has no signing or account configuration.
- This slice neither activates nor changes the actual defaults of the example file or the recipe.
- Outside this code, before any use: approved, normally trusted HTTPS roots on distinct public DNS names, and a backend
  whose issuer, audience, sign-up and SMTP match them.

## Commands

Run from `app/`, on the local machine only:

```sh
npm run config:general-user   # config --type public
npm run start:general-user    # start --go --localhost --clear
npm run export:general-user   # export --platform all --max-workers 1 --output-dir dist/general-user
```

Each sets `AYAFASIH_GENERAL_USER=on` and `EXPO_NO_DOTENV=1` and reads `profiles/general-user.env.local` through
`node --env-file` (Node 22.16, as pinned in `eas.json`). A missing file stops Node before Expo starts. Blank or invalid
origins fail the validator wherever Expo evaluates the config plugins; account sync also stays off without both origins
(PRODUCTION_PROFILE.md). Nothing falls back to the developer-demo, owner or synthetic profile. A variable already set in
the shell wins over the file, and the validator then checks the value actually in use. `config` and `export` also set
`EXPO_OFFLINE=1`.

`start` listens on the loopback address only, so its QR code is not usable from a phone. `export` writes JavaScript
bundles, not signed apps. Stop any other Metro preview first (README, "Switching modes").

## Expo Go

SDK 58 Expo Go includes the `expo-sqlite` 58.0.14 and `expo-secure-store` 58.0.2 used here. Dependency and configuration
inspection support the standard password and one-time-code path without custom native code; actual phone launch and
account lifecycle are still unverified. This app's private-CA transport requires its custom native bridge, which Expo Go
does not include; that separate profile needs a development/native build.

- [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)

## Normal starter opt-in

`EXPO_PUBLIC_NORMAL_USER_STARTER=on` is in the inactive example and the `general-user` recipe. This explicit opt-in now
connects Home, consent, the Unit A route, the controller and answer capture to the same existing exact review gate. The
flag grants build eligibility only and cannot approve content. The actual compiled review, `UNIT_A_STARTER_REVIEW`, is
approved-for-trial for exactly the Unit A content version and hash it records, under an owner-authorized, AI-only
acceptance by one coordinating AI assistant. It is not independent human or expert certification, and it shows no
efficacy or mastery. The gate code is unchanged, and any later edit to the content, its hash or its version denies access
again. The normal route carries no Beta or private wording. This profile stays inactive until actual origins are
supplied, and it adds no extra mode and no arbitrary expiry. Nothing here claims real-user, phone, native or live-backend
validation. Starter eligibility is independent of the requested optional capabilities below, and approval still requires
the exact compiled review. The bounded candidate report is [NORMAL_USER_STARTER.md](NORMAL_USER_STARTER.md).

## Optional Google sign-in and password recovery

These are optional capabilities of the existing production core. This section supersedes the earlier statements that
they must always be off or that production Google is unsupported.

- `EXPO_PUBLIC_GOOGLE_SIGN_IN` and `EXPO_PUBLIC_PASSWORD_RECOVERY` may each be requested `on` or `off`, independently of
  each other and of remember-device.
- Google configuration loading supports production only when `EXPO_PUBLIC_PRODUCTION_ACCOUNTS` is on. The Auth adapter
  forwards the already captured boolean capability for revalidation. The return target is exactly the same public web
  page `/account`, or on native `arabictrial://account`.
- The Google provider credentials and the redirect allowlist of the actual GoTrue are backend-only. They are
  unconfigured and unverified here.
- The account layer checks the actual browser, store and secure WebCrypto. Email and one-time-code sign-in keep working,
  and the user sees a safe note when a requested method is unavailable. Google explicitly `off` does not inspect the
  browser.
- Recovery wires the existing production core when the actual callback, store and crypto work. The incoming-link, PKCE,
  replay and auto-start fences are preserved.
- Both custom native callbacks remain unsupported in Expo Go. No fake button is shown and no phone proof is claimed.
- Operators may request the existing flags together with an approved backend and callback configuration. There is no new
  mode and no expiry.

## Not granted

- Google sign-in and password recovery are not enabled by this page. No backend credential, allowlist, callback or device
  has been configured or verified.
- Content approval is limited to the compiled, AI-only trial acceptance of the exact Unit A starter content described in
  [NORMAL_USER_STARTER.md](NORMAL_USER_STARTER.md). It is not independent human or expert certification and grants no
  efficacy or mastery claim, release, publication or activation.
- Native identity, signing and device proof are not granted.
- The tests use in-memory protocol fixtures. Normal route and provider tests use the genuine compiled acceptance where
  appropriate, but their networks and stores are isolated and synthetic. They are not proof of a live service, mailbox or
  device. The SDK production-origin Google fixture is not live Google, SMTP, TLS or native proof.
