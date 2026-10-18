# Amar local account and sync integration — 2026-10-18

The local React Native developer pilot now connects the existing Arabic learning loop to the local Auth emulator and Go API. This is local/browser verification, not a production release or native-device sign-off. All Arabic exercises remain synthetic, unreviewed draft content; mastery is not assessed. Native device/network/accessibility/performance checks and the Swift iOS implementation remain outstanding. Nothing has been deployed or merged into main.

## Branch scope

- `feature/rn-ux-redesign-20261017`: latest Amar app under `app/`, including the reviewed design, local account/profile UI, account-isolated datasets and durable TypeScript sync journal.
- `feature/local-backend-20261017`: the existing local-only Go API and standalone durable Go journal under `backend/`. Its client baseline and Umar's Android source remain separate from the latest RN app.
- `integration/native-expo-premium-20261017`: the earlier integration snapshot with Umar's Android source preserved and the earlier381-test Amar prototype under `prototype-expo/`. This branch has not been merged with the newer RN or backend branches.

## Implemented and exercised locally

- Synthetic `.test` sign-in/signup, verified account identity, explicit adult-profile creation or own-profile link, optional consented guest copy and account-specific KV/SQLite datasets. Guest originals are preserved.
- Canonical JSON and SHA-256 agree with the Go vectors and all six envelope fixtures. Immutable originals and the exact import request are persisted before sending. Reopen/retry after a lost response, later answers/preferences, receipts, conflicts, multiple local learner sources and stale account/session responses are covered by the original13 sync contracts.
- Offline answer/preference saves, reload and reauthentication, exact frozen-import retry, factual cross-context progress, explicit412 preference resolution, logout without deletion, and a second account's isolation are exercised through the real UI and local services. Remote facts do not become local learning sessions or exposure ledgers.
- Auth credentials, addresses and tokens stay in memory. The tested browser stores contain none of the run’s auth secrets. The browser QA scrubs known synthetic credentials from reports and errors. This is not a claim about production authentication or arbitrary real learner data.

## Verification

- RN: **466 tests pass in 32 suites**, including all13 original protocol/journal cases; TypeScript and Expo lint pass.
- Real local account browser flow: **48 checks across 15 steps pass** in two fresh Chromium contexts, with no unexpected page/console errors or external requests.
- Guest browser regression: **93 checks pass** after account wiring.
- Go backend: normal tests, race tests and vet pass against the isolated loopback PostgreSQL/Auth emulator. The backend source is unchanged by the RN follow-up.
- The older integration snapshot independently passes its 381 tests, TypeScript and lint; those counts do not describe the latest RN tree.

One existing design test now explicitly clears the local-service environment for its unconfigured-build premise and restores it afterwards. Its assertions are retained. The13 sync contracts and six envelope fixtures are preserved.

```bash
cd app
npm ci
npm test -- --runInBand
npm run typecheck
npm run lint
```

Node22.16.0 was used for the RN checks. The built-in SQLite experimental warning is visible in the test output.

## Run the local account pilot

First start the local Go API, PostgreSQL and Firebase Auth emulator according to `backend/docs/Backend_Local_Contract.md` on the backend branch. Supply database credentials privately through the environment; no credentials or captured user data are included in these commits. Use only the `demo-ayailmu` Auth project and synthetic `.test` users.

Then, from `app/` on the RN branch:

```bash
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8092 \
EXPO_PUBLIC_AUTH_EMULATOR_URL=http://127.0.0.1:9099 \
EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-ayailmu \
npm run start -- --web --localhost --port 8087
```

The browser origin is deliberately 8087: the API's CORS allowlist is bounded to localhost/127.0.0.1 on that port. Without valid local-service configuration the account entry is unavailable and guest learning stays available. Sign-in is intentionally lost after a reload; the account's local data survives and remains hidden until the same account signs in again.

## Limits and continuation

These checks cover the local Chromium preview, local emulators, KV and Node SQLite. They do not establish physical-device networking, native redirect prevention, native SQLite lifecycle, screen-reader announcements, app-store readiness, production identity/deployment or offline cold-start/PWA support. No screenshot, video, trace or storage-state capture is part of the browser evidence. Generated browser evidence and local orchestration state remain outside committed source. No qualified content-review or learning-effectiveness sign-off is implied.

All Claude continuation work must use the approved Straitpoint Max account with exact `claude-opus-5-5` and effort `max`. Do not use Pro or Team; if Max is capacity-limited, pause. Keep work on the named feature branches. No deployment, extra-usage purchase, main merge, CI-setting change or replacement of Umar's native source is authorized by this integration checkpoint.
