# SDK58 Compatibility Plan (2026-10-25)

Branch `feature/sdk58-compatible-20261025` (isolated worktree) from `754129f`.
SDK57 source branch `feature/registration-confirmation-20261025` stays at `754129f`.
Nothing from this branch is pushed or published until a separate, exact approval.

## Constraints
- Preserve synthetic account, confirmation, session, and data-isolation behavior.
- `@supabase/auth-js` stays pinned at `2.118.0`; `web.output: "single"` is kept.
- No app ID, branding, new features, UI redesign, or SDK wrapper rewrites.
- No credentials, env, global settings, signing, installers, or backend changes.
- Tunnel: keep the existing ngrok provider (`--tunnel ngrok`); no Expo login.
- All 157 frozen tests/helpers in `phase95/protected-tests.json` stay unchanged
  unless a real failure is reviewed first.

## Steps
1. **Baseline**: confirm a clean tree at `754129f`; record hashes of the frozen
   files from `phase95/protected-tests.json`.
2. **SDK bump**: set `expo` to `~58.0.19` in `app/package.json` (this slice only).
3. **Install (root)**: run `npm install` into a new physical `app/node_modules`,
   then `npx expo install --fix` so Expo 58's bundled versions align the other
   deps and the lockfile. No `--force` or `--legacy-peer-deps`.
4. **Doctor**: run `npx expo-doctor`; fix only what it reports.
5. **Checks**: `npm run typecheck`, `npm run lint`, `npm test`
   (baseline: 1305 tests / 144 suites).
6. **Compatibility fixes**: fix only failures that actually show up. Expected
   area: strict RN instance types (`useRef<View>`, `Ref<View>`,
   `useRef<ScrollView>` → `ViewInstance`/`ScrollViewInstance`). Migrate the ref
   types rather than turning strict APIs off. Also watch for removed
   `InteractionManager`, `NativeMethods`, and deep imports into libraries.
7. **Frozen-file check**: re-hash the frozen files; they must match step 1.
8. **Exports**: build exact-commit web/iOS/Android JS exports; prove the
   registration, login, and session-restore paths.
9. **Local Metro**: isolated, sanitized local Metro serving an SDK58 manifest.
   Check bundles and source maps for private Mac paths and embedded secrets.
10. **Public refresh**: needs specific approval of the new public payload
    before any SDK58 preview goes out.
11. **Device QA**: only the user can prove the app on a physical iPhone
    (Expo Go 58).

## Evidence scope
Mac-side proof covers browser, mock and live-service checks, and JS exports.
It does not cover the phone or a native binary.
