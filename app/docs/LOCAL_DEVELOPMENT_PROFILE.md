# Native local development with normal email accounts

This is an explicit local native profile for the existing Mac backends. It uses real-format email signup, email-code confirmation, password sign-in and the existing account/profile/progress path. It does not create accounts or send mail merely by being configured. It grants no curriculum approval or production release status.

Use `profiles/local-development.env.example` as the complete public build settings. Set the existing authorized simulator bundle identifier explicitly in your ignored local copy; the example identifier is a placeholder and no signing identity or enrollment is created. A conflicting pre-existing identifier is refused, never replaced. It pins the existing public CA and exactly two origins: API `https://localhost:58444`, Auth `https://localhost:58445`. These roots refer to the Mac when used by its iOS simulator. They do not make a physical phone reach the Mac. No public/LAN listener, system trust, ATS setting, private key, signing credential or backend configuration is changed by this profile.

The account environment is `local-development` with `localDevelopment: true`, explicitly opted in by `EXPO_PUBLIC_LOCAL_DEVELOPMENT=on`. It carries neither `productionAccounts` nor `privateQa`. Production continues to require its original distinct public DNS HTTPS roots; its origin guards were not widened. Normal local accounts use the existing `confirmed-email` policy with conventional addresses, not an owner allowlist or synthetic `.test` policy. Signup responses that auto-confirm a session remain refused; confirmation returns a sign-in-required outcome. Google sign-in and password recovery are off in this first local profile. Remembering uses the existing device secure vault, bound to this profile, API, Auth and installation.

Transport is a separate capability. The existing `AyaPrivateQaTransport` native module has a historical name; its low-level certificate/hostname validation contains no account-recipient policy. `withLocalDevelopment` reuses only its bounded public-CA validation and exact-root resource payload. Runtime preparation validates the new account profile, native platform, independent build pin, and bridge binding before returning a fetch. The API, Auth and registration constructors require that injected fetch. A missing or mismatched binding disables account clients; there is no fallback to global fetch, cleartext, broader hostnames, unverified TLS or OS certificate trust.

`withLocalDevelopment` is registered immediately before `withPrivateQa` in app.json. Expo executes later dangerous-mod registrations first, so the old off-profile cleanup runs before the validated local writer. A composed-mod filesystem regression verifies the final CA/binding remains, ordinary production still cleans stale resources, and invalid local settings fail before mods run. It writes the shared native CA resources only for this exact local profile and records `extra.ayaLocalDevelopmentTls.caSha256`. It does not activate private-QA account policy. Ordinary/private/production builds keep their existing profile and transport behavior.

The normal starter becomes build-eligible under this explicit configuration, while the unchanged `starterReviewAccess` still decides whether the exact Unit A content is available. Neither content nor its compiled AI-only trial review was edited. Bilingual/source review, mastery and production acceptance claims are unchanged. Normal account presentation replaces synthetic developer copy but does not claim a public deployment.

For native packaging, load the example settings explicitly, apply Expo config/plugins, regenerate native resource membership as needed, bundle the current JavaScript profile, and rebuild/install the native Debug simulator app. Do not use a pre-existing app binary as evidence that this new pin/profile is embedded.

For configuration inspection without native resource generation:

```sh
EXPO_NO_DOTENV=1 EXPO_OFFLINE=1 node --env-file=profiles/local-development.env.local node_modules/expo/bin/cli config --type public
```

Copy the example to the ignored `profiles/local-development.env.local`, then supply the authorized public CA path and its exact DER SHA-256. The example intentionally leaves them empty. Do not commit the local profile, CA, generated native binding or signing material. If the certificate changes, update the build and native binding together; a wrong pin is rejected.

## Production-mode JavaScript for the simulator demo

The November 10 warning-footer fix used production-mode JavaScript inside an existing native Debug simulator artifact. It did not suppress LogBox or change account flags, API origins, certificate pins, native code, bundle identity, or stored learner progress. Source and native Debug builds alone do not reproduce that packaging choice.

With the explicit local profile configured and the normal native artifact prepared, export the current source into a separate output directory:

```sh
mkdir -p dist/local-demo
export TMPDIR="$(mktemp -d)"
EXPO_NO_DOTENV=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 \
  node --env-file=profiles/local-development.env.local node_modules/expo/bin/cli \
  export:embed --entry-file node_modules/expo-router/entry.js --platform ios \
  --dev false --bytecode --minify false --max-workers 1 --reset-cache \
  --bundle-output dist/local-demo/main.jsbundle --assets-dest dist/local-demo \
  --sourcemap-output dist/local-demo/main.jsbundle.map
```

Use an isolated temporary cache directory when exporting to avoid reusing another build profile. Before installing, verify emitted public account flags and exact origins against the native constants and CA binding. Embed the output only in a copy of the matching simulator artifact, then re-sign that copy and verify its signature. A native Debug app can choose a running Metro server instead of its embedded bundle, so verify the actual runtime bundle too. Install in place, without uninstalling or erasing learner data, and check restart/persistence. These are packaging instructions, not a claim of live signup, email, sync, or physical-phone acceptance. Compiled bundles and app artifacts are deliberately not in Git.
