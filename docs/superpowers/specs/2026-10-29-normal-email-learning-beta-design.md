# AyaFasih learning-beta design, from clean base `5ed9bb38`

I didn't edit anything or run Bash. I used 10 file reads plus targeted greps, and no lookup was denied.

## Recommendation

Add a fourth explicit account profile, `environment: 'learning-beta'`, with a capability flag `learningBeta: true`. It works like `privateQa`: the environment string and the flag are both required, and nothing reads them from projected UI fields.

- **Starter gate:** the starter stays behind the existing `starterReviewAccess()`. One shared function, `starterBetaBuild()`, becomes "private beta OR learning beta".
- **Disabled features:** the profile itself refuses to turn on if registration, Google or recovery is anything but exactly `"off"`.
- **Recovery hole:** one extra refusal line closes a recovery gap described below.

**Why not something smaller:**
- **Staging plus a capability** would change staging's synthetic-only rule (`signInAddressRefusal`, `supabaseAuth.ts:167-171`).
- **A capability on the production profile** brings in the release redirect (`unit-a-pilot.tsx:21`), production recovery (`recoveryDevice.ts:106-110`) and the confirmed-email registration path (`registrationController.ts:85`).
- **The environment string without a flag** is the only smaller option. The flag costs about six lines and buys one important property: every existing caller that doesn't know about the new profile automatically gets `null`. Those callers are `registration.ts:332-336` and `recoveryDevice.ts:101-110`, which pass at most three arguments to the origin checks.

## Existing code this relies on

- `isUnknownAccountEnv` (`staging.ts:45`) must stay unchanged. `loadGoogleConfig` uses it (`googleConfig.ts:114`), so Google stays off for `'learning-beta'` with no code change. `isSafeGoogleConfig` (`googleConfig.ts:87`) also refuses any environment other than local or staging.
- **Recovery gap:** `isSafeRecoveryConfig` (`recovery.ts:158`) accepts a native callback *before* it checks the environment (`:164`). An unknown profile would therefore pass, so this needs an explicit refusal.
- **Registration** already fails closed for a new environment (`registrationController.ts:84-85`, `registration.ts:331-345`). No change needed, only tests.
- **Session binding:** the Auth adapter maps profiles at `supabaseAuth.ts:582-583`. An unknown environment falls back to `'local'`, which would demand synthetic addresses. The two-root check (`:550`) only covers production and private-qa.
- **Starter entry points** all go through `starterBeta()` (`index.tsx:52`, `consent.tsx:57`, `unit-a-pilot.tsx:22,48`). There are two direct gates as well: `UnitAPilotScreen.tsx:101` and `controller.ts:1016`.
- `isReleasePresentation` stays false for the new profile, so `/unit-a-pilot` is not redirected.
- `withPrivateBeta.js:76` does nothing unless `EXPO_PUBLIC_PRIVATE_BETA` is `"on"`. If it is, it requires staging (`:46`). The new profile therefore needs its own identifier plugin; otherwise it would build with the default identifiers.

## Design: files and symbols

1. **New `app/src/account/learningBeta.ts`:** just `export const LEARNING_BETA = 'learning-beta'`. It imports nothing, so no import cycle with `staging.ts`.
2. **`app/src/account/supabaseConfig.ts`:**
   - `SupabaseEnv` gains `EXPO_PUBLIC_LEARNING_BETA`, `EXPO_PUBLIC_APP_MODE`, `EXPO_PUBLIC_PRIVATE_BETA`, `EXPO_PUBLIC_ACCOUNT_REGISTRATION`, `EXPO_PUBLIC_GOOGLE_SIGN_IN` and `EXPO_PUBLIC_PASSWORD_RECOVERY`, all added to the default object.
   - `EnabledSupabaseConfig.environment` gets `| typeof LEARNING_BETA`, plus a new field `learningBeta?: true`.
   - New `loadLearningBetaConfig(env)`, called *before* the `isUnknownAccountEnv` check. It checks, in this order: LEARNING_BETA `"on"`, APP_MODE `"tester"`, then PRODUCTION_ACCOUNTS, PRIVATE_QA, PRIVATE_BETA, ACCOUNT_REGISTRATION, GOOGLE_SIGN_IN and PASSWORD_RECOVERY, each exactly `"off"`. Then the API must pass `stagingOrigin` and the Auth server must pass `stagingOrigin` and differ from the API.
   - It returns `{enabled, provider, environment: LEARNING_BETA, learningBeta: true, apiBaseUrl, authUrl}`.
   - `accountAuthOrigin(value, env, pa?, pq?, learningBeta?)` gets a new first line: `if (learningBeta !== undefined && env !== LEARNING_BETA) return null`. A new branch then accepts `env === LEARNING_BETA` only when `learningBeta === true`, `pa === undefined` and `pq === undefined`, and returns `stagingOrigin(value)`.
3. **`app/src/account/staging.ts`:** the same fifth parameter and branch in `accountApiOrigin`.
4. **`app/src/auth/supabaseAuth.ts`:**
   - Add `typeof LEARNING_BETA` to the `RememberedRecord['profile']` union.
   - `signInAddressRefusal`: for the new profile, accept a conventional address and otherwise return `'invalid_email'`.
   - Pass `config.learningBeta` to both origin checks at `:548-549`.
   - Add the new profile to `twoRoots` and to the profile mapping at `:583`.
5. **`app/src/auth/recovery.ts`:** in `isSafeRecoveryConfig`, add `if (environment === LEARNING_BETA) return false;` before line 158.
6. **`app/src/api/client.ts`:** a new `learningBeta?: boolean` option, passed as the fifth argument to `accountApiOrigin`.
7. **`app/src/ui/AccountContext.tsx`:**
   - At `:317`, the new profile uses `PRODUCTION_SERVICE`.
   - At `:371-376`, pass `...(config.learningBeta ? { learningBeta: true } : {})`.
   - Nothing else changes: Google, recovery and the vault rules stay as they are.
8. **Labels:** `AccountPanel.tsx:331-335` and `settings.tsx:75-76,154` give the new profile production's wording rather than falling through to "Akun lokal". Labels only, never a gate. StarterHome keeps «Beta privat», which is still accurate because there's no registration.
9. **New `app/src/config/learningBeta.ts`:**
   - `learningBetaEnabled(env?)` requires APP_MODE `tester` and a `loadSupabaseConfig` result with the new environment, `learningBeta === true` and neither of the other two capability flags.
   - `starterBetaBuild(env?)` returns `loadPrivateBetaConfig(env).enabled === true || learningBetaEnabled(env)`.
   - When `env` is undefined, both read `process.env` (literal reads).
10. **Gate call sites:** `StarterHome.starterBeta:22`, `UnitAPilotScreen.tsx:101` and `controller.ts:1016` all use `starterBetaBuild(...)`. The type of `betaEnv` becomes `PrivateBetaEnv & LearningBetaEnv`. `privateBeta.ts` is not touched.
11. **Build:**
    - `eas.json` gets a new `learning-beta` profile modelled on `private-beta`: same distribution, node, apk and ios settings.
    - Its env: the new profile's six "off" flags, LEARNING_BETA `"on"`, APP_MODE `tester`, `local-supabase`, `EXPO_PUBLIC_REMEMBER_DEVICE: "on"`, `EXPO_NO_DOTENV`, `EXPO_NO_TELEMETRY`. No URLs; the owner supplies them.
    - New `plugins/withLearningBeta.js`, a mirror of `withPrivateBeta.js`. It requires `AYAFASIH_LEARNING_BETA_IOS_BUNDLE_ID` and `AYAFASIH_LEARNING_BETA_ANDROID_PACKAGE`, and refuses to overwrite an existing different identifier.
    - The plugin must be registered in the app config. I didn't read that file.

## RED/GREEN batches (new test files only)

**B1 — config and origins.** New `account/__tests__/learningBetaConfig.test.ts`:
- A full valid env gives exactly the config object, with no `productionAccounts` or `privateQa` key.
- Each flag unset, wrong or differently cased (APP_MODE `developer-demo`, any feature flag `"on"`) turns account sync off. The reason names the setting, never its value.
- API/Auth values that are `.test`, localhost, http, or have a port, path or trailing slash are refused, and so is Auth equal to API.
- LEARNING_BETA `on` next to a local, staging, production or private-qa env gives the same result as without it.
- The origin checks return `null` without the capability, with `productionAccounts` or `privateQa` beside it, or with the capability on another profile.
- `isUnknownAccountEnv('learning-beta')` is still `true`.
- GREEN: steps 1–3.

**B2 — Auth and API adapters.** New `auth/__tests__/learningBetaAuth.test.ts`:
- A conventional email signs in at the Auth root through a fake SDK. A non-address is refused before any request.
- A remembered record is written with the new profile, bound to its two roots; records from other profiles or roots are refused and cleared. Restoring or re-authenticating uses only the Auth root.
- `createSupabaseAuth` throws, with nothing sent, when: the capability is missing, a `google` option is given, a native `recovery` option is given, or Auth equals API.
- `createApiClient` accepts the new profile only with the capability.
- `registrationPolicy(cfg, 'on')` is `null`, and `createRegistration` refuses every policy.
- `loadGoogleConfig` with `GOOGLE_SIGN_IN=on` stays off.
- `prepareRecovery` returns `null` even with `PASSWORD_RECOVERY=on`.
- GREEN: steps 4–6.

**B3 — provider wiring.** New `ui/__tests__/AccountContext.learningBeta.test.tsx`, following the env setup in `AccountContext.privateQa.test.tsx`:
- The provider builds services, uses the global fetch (the private QA network stays off), and the injected vault receives a record with the new profile.
- If any feature flag is `"on"`, account sync is off and no Google, registration or recovery UI appears.
- The labels aren't "lokal".
- GREEN: steps 7–8.

**B4 — starter gate.** New `config/__tests__/learningBetaStarter.test.ts` and `__tests__/learning-beta-starter-flow.test.tsx`, mocking review the same way the existing private-beta flow test does:
- With the real compiled review, `starterReviewAccess().allowed` is false and `starterBeta('tester')` is `'pending'`. Home shows `StarterPending` and no `beta-starter-open`. Direct visits to `/unit-a-pilot` show pending, and `/consent` redirects.
- With a mocked approved review: "Buka Unit A" appears, answers are captured to the account, and manual sync works.
- Controller with the new env: `'review'` when pending, `null` when approved, and `'mode'` in developer-demo.
- `isReleasePresentation` is false.
- `/next-lesson`, `/guide`, `/progress` and `/summary` redirect to `/` in both pending and reviewed states. If `/next-lesson` doesn't, add `starterBeta(rules.mode) !== 'off' → <Redirect href="/" />` there, but only if all frozen tests stay green.
- GREEN: steps 9–10.

**B5 — build profile.** New `plugins/__tests__/withLearningBeta.test.js` and an `eas.json` profile test:
- The new profile's env matches exactly.
- `private-beta`, `production`, `staging-tester` and `developer-preview` are deep-equal to how they are now.
- The plugin does nothing when off, and on: validates the same checks, the two identifiers and the no-overwrite rule.
- GREEN: step 11.

## Stop conditions for the writer

- **Frozen-test conflict:** stop and report, without editing frozen files, if any of these fails: a frozen test that lists eas.json profiles or app-config plugins, one that checks which `process.env` keys are read, or any of the 205 existing files.
- **Review stays pending:** no change to `review.ts`, `UNIT_A_STARTER_REVIEW` or any content. The learning-beta build shows only the pending screen until a separate human review record matches the exact content hash.
- **Not phone ready:** passing tests or a successful compile don't mean the content is approved or the app is ready for a phone. Owner-supplied roots and identifiers, signing, building and installing are all out of scope.


## Coordinator scope clarifications
The approved subset is the existing exact Unit A starter (two lessons and20 questions), not arbitrary lesson IDs or automatic content approval. The compiled review remains pending. Normal-beta service wording/consent identity must be explicit and must not claim production readiness or silently reuse local/staging consent. New profile gates must preserve all existing profiles. Quran feed is a separately authorized next slice after this overlapping work, not part of the current profile implementation batch.
