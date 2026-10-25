# AyaIlmu local export safety implementation plan

> Execute inline, one writer; use the existing test-driven and verification workflow.

**Goal:** prevent stale URI grants, partial export bundles and failed/stale share handoffs without changing collection, export scope or deletion policy.

**Grounding:** CODE_RULES CR-DAT-4 defines user-selected local JSON/CSV sharing and local deletion. Existing SettingsDataSource exports all profiles and already clears cached exports on profile/child/all deletion. Backend architecture explicitly leaves real-user export/deletion/retention undefined. These contracts must not be invented or silently applied to GoTrue.

**Author:** Kimi K3.1 Pro HIGH for product code. No infrastructure change is planned; Sonnet HIGH remains required if one becomes necessary.

## Boundaries

- Preserve existing JSON/CSV schema, all-profile scope, omitted labels/birth years, adult-kind gating and user-selected recipient. No automatic uploads or changes to consent/policy text.
- No server/export/delete endpoint, migration, GoTrue account action, real child data, credentials, network/security setting, store operation or iOS rewrite.
- Test only disposable JVM/Robolectric filesystem/context fixtures; never delete actual app data on a device.
- Existing source branch/PR3; no merge/rebase/history rewrite.

## Task 1: export bundle publication

Files: core/data/export/Export.kt and focused app/data tests using actual FileProvider under Robolectric.

- Prove RED: two exports with the same minute stamp must never reuse a granted URI for new data; a failed new export must not leave partial shared files or destroy the previous complete bundle.
- Use a fresh bounded safe export identifier/path, publish only after both files and URIs are ready, clean only the new failed bundle; retire previous cache exports after success. Preserve existing deletion clear behavior and avoid write/clear interleaving within file operations. No new libraries or custom crypto.
- Test real ContentResolver reads, same-stamp uniqueness, failure cleanup, replacement and clear.

## Task 2: safe share handoff

Files: feature/common/Share.kt, settings/SettingsScreen.kt, SettingsViewModel.kt and focused tests.

- Prove RED: missing share activity/security rejection must become existing EXPORT_FAILED notice rather than crash; successful chooser retains read-only ClipData grants.
- Prove RED: pending/buffered exports cannot be shared after active profile changes, including A→B→A; preserve current ADULT-kind rule, without assuming it means legal age18.
- Add only the smallest typed handoff/error and owner-generation fencing needed. Do not broaden collection or alter data scope.

## Task 3: verification/publication

- Focused RED→GREEN, then full data/demo/syncLab unit gates, release lint/AAB and debug APK build. Existing endpoint/candidate checks remain applicable.
- Independently review, commit/push scoped verified changes, inspect exact-head candidate CI and artifacts. No merge, deployment or store release.

## Decisions still required

Server/account export scope (all household/child learners versus selected consenting adults, provider identity data), guardian-account deletion with dependents, identity revocation/removal, request deadline and live/backup/received-file retention remain owner decisions. The existing six-month trial-export rule does not define server sync retention. iOS is not planned by current source requirements; only an explicitly approved incremental KMP/Compose feasibility scope should start that new platform.

## Execution ledger

- Product code authored by the single Kimi K3.1 Pro HIGH session; no infrastructure, dependency, manifest or policy changes.
- Independent review found stale authorization after observed-profile failure. One fix pass invalidated unavailable/ineligible owners and added behavioral regressions: three actual RED failures, then GREEN. Null-state control passed throughout.
- A separate disposable archive control kept the old32b ExportFiles implementation and ran the new FileProvider regressions:5cases,2expected failures (same-stamp URI reuse and failed-provider replacement),0errors. The working tree was untouched.
- Final focused25tests passed; full data40/demo306/syncLab371 (2provider-fixture skips),0failures/errors. Release lint/AAB/debugAPK tasks passed.
- Existing all-profile export scope, schema, ADULT-kind eligibility, local deletion and read-only grants remain. No server/GoTrue deletion or new backend lifecycle contract was invented.
- iOS exclusion is explicit in ai-memory/PROJECT_OVERVIEW.md:27; Expo reference-only at:33. The newer store-readiness request requires a separate platform-scope decision; no KMP migration was started.
- Commit/push and exact-head candidate CI are the supervisor publication checks after these local results.
