# Private Tester Beta: build preparation

**Status: build-profile preparation only. This is not a signed or distributed tester build.** Local source checks and
fixture-configured JavaScript exports are recorded separately; the real-account build and upload commands below remain
unexecuted.

This prepares a TestFlight-capable build profile (`private-beta` in `app/eas.json`) and the config plugin that supplies
the app identifiers (`app/plugins/withPrivateBeta.js`). It does not make a ready tester beta.

## Not ready: known gaps

Do not hide or work around these. None of the restrictions below is removed by this preparation.

- **Human content review is still pending.** The beta never approves content (`app/src/pilot/unitA/review.ts`).
- **No app identifiers.** The iOS bundle identifier and Android package name are not chosen. The owner must supply them.
- **No Apple team, App Store Connect access or Expo owner/project.** None is configured here, and none is defaulted.
- **No stable public HTTPS origins.** The account API and the Auth server each need a stable public root origin. None exists yet.
- **Source gap: this is NOT a normal-email tester beta.** The current ordinary staging Auth accepts only `.test` addresses,
  and profile sign-up is off. A tester with an ordinary email address cannot sign in. Closing that requires further
  auth/email-policy implementation and verification; this build-profile preparation does not make that change.
- **Manual account recovery is owner-deferred and mail is held.** No emails are sent.
- **Registration, Google sign-in and password recovery stay off.** The profile sets `EXPO_PUBLIC_ACCOUNT_REGISTRATION=off`,
  `EXPO_PUBLIC_GOOGLE_SIGN_IN=off` and `EXPO_PUBLIC_PASSWORD_RECOVERY=off` explicitly, so an external build environment
  cannot silently turn on a flow that is not prepared. Manual recovery is owner-deferred and has not passed. This is
  configuration only: it does not make a real normal-email beta and changes no auth policy or service.

## What the preparation changes

| File | Change |
| --- | --- |
| `app/plugins/withPrivateBeta.js` | New synchronous config plugin. A no-op (the identical config object) unless `EXPO_PUBLIC_PRIVATE_BETA` is exactly `on`. |
| `app/app.json` | Registers `./plugins/withPrivateBeta` beside `./plugins/withPrivateQa`. No identifier, owner or project is declared. |
| `app/eas.json` | Adds only the `private-beta` profile. Other profiles and the `cli` block are unchanged. |

When the flag is `on`, the plugin requires all of the following, and otherwise throws an error that names the setting and
never its value:

- `EXPO_PUBLIC_APP_MODE` exactly `tester`
- `EXPO_PUBLIC_ACCOUNT_ENV` exactly `staging`
- `EXPO_PUBLIC_AUTH_PROVIDER` exactly `local-supabase`
- `EXPO_PUBLIC_PRODUCTION_ACCOUNTS` exactly `off`
- `EXPO_PUBLIC_PRIVATE_QA` unset, empty or exactly `off`
- `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_SUPABASE_AUTH_URL`: two distinct staging root origins, as in
  `app/src/config/privateBeta.ts` and `app/src/account/staging.ts`. That means `https`, a lower-case public DNS name,
  no port, no path, query, fragment or userinfo, no `localhost` or private/special-use suffix, and no normalization.
- `AYAFASIH_BETA_IOS_BUNDLE_ID`: owner-provided, nonsecret, a reverse DNS identifier.
- `AYAFASIH_BETA_ANDROID_PACKAGE`: owner-provided, nonsecret, a reverse DNS package name (segments start with a letter;
  letters, digits and underscores only).

The plugin sets only `ios.bundleIdentifier` and `android.package`. An existing, different identifier is refused, never
overwritten. The scheme, storage, auth redirects and everything else are preserved. It touches no Apple team, Expo
owner or project, certificate, credential, or CA/trust setting.

## The `private-beta` profile

- `distribution: store` (the TestFlight path), `ios.simulator: false`, `android.buildType: apk`.
- No development client, no auto-submit and no `submit` configuration.
- Node `22.16.0`, the same version as the existing profiles, which sits inside the `^22.13` engine range of the installed
  Expo 58 / React Native 0.88.
- Env: `EXPO_PUBLIC_PRIVATE_BETA=on`, `EXPO_PUBLIC_APP_MODE=tester`, `EXPO_PUBLIC_ACCOUNT_ENV=staging`,
  `EXPO_PUBLIC_AUTH_PROVIDER=local-supabase`, `EXPO_PUBLIC_PRODUCTION_ACCOUNTS=off`, `EXPO_PUBLIC_PRIVATE_QA=off`,
  `EXPO_PUBLIC_ACCOUNT_REGISTRATION=off`, `EXPO_PUBLIC_GOOGLE_SIGN_IN=off`, `EXPO_PUBLIC_PASSWORD_RECOVERY=off`,
  `EXPO_NO_DOTENV=1`, `EXPO_NO_TELEMETRY=1`.
- The profile embeds **no** origin or identifier. These must be supplied later through an approved owner/runtime handoff
  (for example the build shell or the owner's EAS environment), never committed.

## Release prerequisites (not all verified)

1. Content review completed by a human, and recorded as the review guard expects.
2. An Apple Developer team and App Store Connect access with a role that may create apps and upload builds. Roles are
   described in the official overview:
   <https://developer.apple.com/help/app-store-connect/manage-your-team/overview-of-accounts-and-roles>
3. The owner's chosen iOS bundle identifier and Android package name, and a matching App Store Connect app record.
4. Two stable public HTTPS root origins (account API, Auth server), distinct from each other.
5. An auth/email policy that actually admits the intended testers (see the source gap above).
6. An Expo account and project for the build, set up by the owner. Nothing here defaults one.
7. Node `22.16.0` is installed and used for local checks. EAS CLI (`>= 16.0.0`, as `eas.json` requires) and its authorized
   build-project context still need verification before a real build. This work installs nothing.

## Progress evidence boundaries

The starter controller resumes its own persisted document on the same device. Explicit guest copying preserves exact
archives, changes only the matching learner's owner, and never invents past answer timestamps. New account choices can
be captured through the existing answer journal; capture failure retains the lesson choice for retry. Existing pilot
history is not backfilled. Held-out answers remain deferred rather than exposing answer keys or claiming mastery.

Local checks exercise real stores/controllers and the SDK against in-memory backend fixtures. Separately, 100 journal
envelopes pass a local copy of the backend validator as **unregistered** curriculum. Neither check proves a live upload,
cloud restoration of the starter controller, native execution of this new source, or learning efficacy. The compiled
human-review manifest remains pending; no lesson is automatically approved by the beta flag.

Profile fields follow the official reference: <https://docs.expo.dev/build/eas-json/>

## Commands, for later (not run)

Run from `app/`. Values in angle brackets come from the owner and are never committed. Run only after every prerequisite is met.

Validate the resolved config without building (the plugin throws on any wrong setting):

```sh
AYAFASIH_BETA_IOS_BUNDLE_ID=<owner-bundle-id> \
AYAFASIH_BETA_ANDROID_PACKAGE=<owner-package> \
EXPO_PUBLIC_API_BASE_URL=<api-root-origin> \
EXPO_PUBLIC_SUPABASE_AUTH_URL=<auth-root-origin> \
EXPO_PUBLIC_PRIVATE_BETA=on EXPO_PUBLIC_APP_MODE=tester EXPO_PUBLIC_ACCOUNT_ENV=staging \
EXPO_PUBLIC_AUTH_PROVIDER=local-supabase EXPO_PUBLIC_PRODUCTION_ACCOUNTS=off EXPO_PUBLIC_PRIVATE_QA=off \
EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 \
npx expo config --type public
```

Export a bundle to check that it builds (same variables as above):

```sh
npx expo export --platform ios
```

Signed iOS build (needs the owner's Apple team and credentials; same variables as above, supplied by the owner):

```sh
eas build --profile private-beta --platform ios
```

Uploading to TestFlight is a separate, owner-approved step; no `submit` configuration exists here.

## Device QA

Custom native QA on a real iPhone needs a signed build installed through TestFlight or another approved route. Expo Go
cannot run it.
