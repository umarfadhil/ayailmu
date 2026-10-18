# Session Learnings — AyaIlmu

Budget: ≤ 60 KB active. Newest first. One entry per session (or per follow-up within a session), ≤ 12 lines, format:

`## YYYY-MM-DD (follow-up N) — <what> (<STAMP>)` then bullets: **Change**, **Why**, **Verified by** (command/device or "not verified"), **Open**.

Compaction (run when `check_budget.py` reports over budget, or quarterly): entries older than 90 days or fully superseded move verbatim to `archive/SESSION_LEARNINGS_<YYYY-Qn>.md`; anything still true becomes a numbered rule in CODE_RULES or a row in FILE_MAP first, then the entry is removed here. A learning never lives in two files.

## 2026-10-17 (follow-up 6) — Expo reference integrated with native main; current docs reconciled (IN SOURCE; no new native verification)

- **Change:** `integration/native-expo-premium-20261017` combines `origin/main` @ 117df50 with `feature/four-choice-learning-loop` @ ef28606 and 11 approved premium source/test/doc files, relocated into `prototype-expo/`. Reconciliation changed docs only; the approved prototype source snapshot and native Android source were preserved. Current paths, historical plan notices, readiness and file-map entries were reconciled.
- **Why:** owner direction is Kotlin Android and Swift iOS at launch; Expo is reference only. Swift is not implemented. PROJECT_OVERVIEW also records the separately approved local Go/PostgreSQL/Firebase workstream; no backend implementation is included here.
- **Verified by (integration coordinator):** 23 Jest suites / 381 tests, typecheck and Expo lint pass on Node 22.16.0 with existing dependencies and ignored Expo-generated environment types; no install. Known warnings: Expo Router multiple-linking and Node SQLite experimental. No new Gradle, native build/device run, Expo export or rendered/browser QA; these checks establish no native release readiness.
- **Open:** native Arabic remains typed/binary v0.1; the latest four-choice Arabic v0.3 contract is unported and native parity unestablished. The four-choice "learned" rule and seven full-sentence question-format decision remain distinct. Content is unreviewed, tester mode shows no lessons, premium fixes need rendered QA/Indonesian review, and iOS counterparts of Play-specific decisions remain open.

## 2026-10-17 (follow-up 5) — P3b written (IN SOURCE); `.github` moved into the repo

- **Change:** Settings (language, session length, Arabic size, daily reminder, consent withdrawal, export, delete profile/all, learner ID, support@petalytix.id), Progress (three honest lines / one bar), Arabic trial consent gate (v arab-trial-1, 18+), interim count in the leave dialog, heading semantics, Roborazzi screenshot tests (27 shots), export/delete moved from the dev card to Settings. `.github/` files moved from `Claude outputs/` with `mv` on the device bridge (hashes match the session copies).
- **Decisions (Umar):** reminder now (P3b); Roborazzi; contact support@petalytix.id (mailbox still to create); exported trial data kept ≤ 6 months after the trial.
- **Review caught (fixed):** English screenshots would have rendered Indonesian (locale now via Robolectric qualifiers); screenshot tests fail in release unit-test tasks (excluded); deleting the last adult could orphan child profiles (refused); a corrupt settings file would crash every start (corruption handler); a cold start inside the alarm window skipped today's reminder (`ensure`).
- **Verified by:** static checks (181 string keys id/en, refs, comments, imports) + review agent that compiled and ran P3bLogicTest, SettingsAndConsentViewModelTest, SessionViewModelTest, StepMapperTest with kotlinc 2.2.20 against the real engine and packs (30/30 pass, Android types stubbed). No Gradle run.
- **Verify on Windows:** Sync (downloads Roborazzi 1.47.0; bump if unavailable) → `./gradlew :core:data:testDebugUnitTest :app:testDemoDebugUnitTest :app:lintDemoDebug` → `:app:recordRoborazziDemoDebug`, look at `app/src/test/screenshots/`, commit them. Phone: Settings → reminder on (permission prompt) at a time 2–3 min ahead → notification; Arabic card → consent → session; Progress for both tracks; child profile cannot change reminder or see Data.
- **Open:** consent text needs UU PDP review; ktlint still report-only (run `ktlintFormat` then flip `ignoreFailures` at the P3 gate); `Claude outputs/` is empty and can be deleted.

## 2026-10-17 (follow-up 4) — P3a playable loop written (IN SOURCE); P2 stamped COMPILED

- **Change:** onboarding (language applied immediately on first run, neutral birth-year list, nickname, under-13 → "ask a parent"), root switches between onboarding and the nav graph, profile switcher + "Tambah profil", Home shelf (tracks filtered by profile language + audience, "Lanjutkan" for today's unfinished session), session screen (lesson cards with ochre clue box, 9 v1 renderers, "Saya belum tahu", feedback panel, gem card, counts-only summary, leave dialog), 6 new design components. Math pack → `mat-sample-0.2` (item 001 got dots to count, 009 shows its sequence in the localized line). Split P3 into P3a/P3b (BUILD_PLAN). Rules: CR-ENG-12, CR-KT-8, age rule in CR-DAT-5.
- **Why these choices:** child = younger possible age from a birth year (Families-safe); v1 filtering and resume rule shared by Home and session so "Resume" never lies; save-before-advance kept from the controller, a failed write keeps the answer on screen.
- **Verified by:** static checks (103 string keys id/en parity + format args, R.string refs, comment/brace scan, imports) and an independent review subagent that read all files against the library versions and traced every new test against the engine and packs (it caught `:` in two test names → CR-KT-8). No Gradle run.
- **Verify on Windows:** Sync → `./gradlew :app:testDemoDebugUnitTest` (5 test classes) → run the demo build. On the phone: onboarding in English → app switches to English at once; pick 1990 → nickname → Home shows no subject (Arabic is Indonesian-only, math is for children — expected); Switch profile → Add profile → Bahasa Indonesia, 2017, "Sari" → Home shows Matematika → play to the summary (try every activity type, leave mid-way and check "Lanjutkan"). Create an Indonesian adult → Arabic DEMO session (typed answers, the who-question, a follow-up item after a wrong answer).
- **Open:** pick_image options show dashed draft frames until P4 art; P3b scope above; commit + `.github` move still pending.

## 2026-10-17 (follow-up 3) — P0 DEVICE-TESTED; P2 data layer written (IN SOURCE)

- **Device result (Umar's phone, 03:52):** demo build launches, English + dark mode followed from the system, paper grain, demo banner, Start disabled. P0 → DEVICE-TESTED (one phone; tablet pending). The full app build also compiled every P1 module (`:app` depends on all), so P1 main code is COMPILED; its tests have still never run.
- **Decision:** Umar chose to follow the plan (P2 → P3) rather than a quick playable slice; the "No learning content" Home is expected until P3.
- **Change (P2):** Room v1 + DAOs + atomic `RoomSessionStore`; typed DataStore settings; `ProfileRepository` (Anak-from-Adult, cascade delete), `AnswerRepository`, `ContentRepository` with `config/catalog.json`; JSON+CSV export through FileProvider; delete-all; per-app language from the active profile (`AppCompatActivity`, AppCompat DayNight theme, night window colour); demo-only Developer check card on Home (tracks/items/problems, profiles/answers, create test profile ID/EN, export, delete-all with confirm). Libraries added: appcompat 1.7.0, robolectric 4.14.1, androidx.test core 1.6.1, Room Gradle plugin. Gate now includes `:core:data:testDebugUnitTest`.
- **Verified by:** static only — catalog aliases, 28 string keys id/en + format args, R.string refs, comment/brace/paren scan, project imports. 10 new tests never run.
- **Verify on Windows:** (1) Sync; (2) `./gradlew :core:data:testDebugUnitTest` (first run downloads Robolectric's Android 14 jar); (3) full gate; (4) commit the generated `android/core/data/schemas/…/1.json`; (5) on the phone: Developer check shows "2 tracks, 29 items, 0 problems"; tap "Create an Indonesian test profile" → app switches to Indonesian; English profile → back to English; Export → share sheet with .json + .csv (open the CSV in Sheets/Excel); Delete all → counts reset. (6) Stamp P2 COMPILED/DEVICE-TESTED, approve P3.

## 2026-10-17 (follow-up 2) — Run failed: "Error loading build artifacts from …\android\app\build\intermediates\apk_ide_redirect_file\…\redirect.txt" (environment)

- **Cause:** side effect of follow-up 1. Gradle now builds into `%LOCALAPPDATA%\ayailmu-build` (confirmed: no `build` folders left in the repo), but Studio's Run uses the project model from the last sync (20:45, before the change) and looked for the APK in the old `android\app\build`.
- **Fix (Windows):** File → Sync Project with Gradle Files, then Run. Added off-switch `ayailmu.externalBuild=false` (gradle.properties) to the root build in case Studio misbehaves with the external folder; rule text in CR-REL-7.
- **Verified by:** device-side listing (no in-repo build dirs), sha256 of root `build.gradle.kts` session vs device (97fec1ffa6da). Whether the APK itself built is unknown; if Run fails again after the sync, read the Build tab's first error.

## 2026-10-17 (follow-up 1) — `clean` failed: "Unable to delete … core\engine\build\libs\engine.jar" (environment, not code)

- **Cause:** a Windows file lock. `:core:engine` is the only plain-JVM jar consumed by the Android modules, and the Gradle/Kotlin compile daemons keep dependency jars open between builds; the repo being in OneDrive (sync + scan) adds more locks. Same family as AyaKasir's 2026-10-16 "Daemon compilation failed".
- **Good news hidden in it:** `engine.jar` was rebuilt at 20:38 on 2026-10-16, after the P1 files landed, so `:core:engine` (and its deps :core:model, :core:content) **compiled**. Tests not yet run.
- **Change:** root `build.gradle.kts` moves all build outputs to `%LOCALAPPDATA%\ayailmu-build\<module>` when the repo path contains "OneDrive" (CR-REL-7). Checked that the device mount is trustworthy for this repo: staged real Windows copies hash-identical to the mount view.
- **Unblock now (Windows):** `.\gradlew --stop` → close Android Studio → delete `android\build` and `android\core\engine\build` by hand → reopen, Sync, Build. New outputs appear under `%LOCALAPPDATA%\ayailmu-build`.

## 2026-10-17 — Build error "Unclosed comment" in PackValidatorCli.kt fixed (IN SOURCE)

- **Cause:** KDoc contained the glob `packs/**.json`; Kotlin block comments nest, so `/*` inside it opened a second comment that never closed. Durable rule → CR-KT-7.
- **Change:** header turned into line comments (also corrected: the CLI validates packs only, not rule files). Scanned all `.kt` files for nested/unclosed comments — none left. Pre-emptively typed `words: Map<String, WordState>` in `SkillProjector` (untyped `emptyMap()` in an if-branch can fail inference).
- **Verified by:** comment scanner over all 46 `.kt` files; no Gradle run.
- **Next on Windows:** rebuild; run `./gradlew :core:model:test :core:content:test :core:engine:test :core:content:validatePacks` and paste the first error, if any.

## 2026-10-16 (follow-up 5) — P1 content model + engine port written (IN SOURCE, not compiled; P0 gate still pending)

- **Change:** `:core:content` schema v1 (bilingual, catalog types + variants, gems with sources), gating, full validator, `validatePacks` Gradle task; `:core:engine` ported from the TS prototype tests-first — scoring, freshness, session state machine, controller — plus new `ReviewScheduler` and `SkillProjector`; model gained `Response`/`AnswerEvent`/outcome enums; packs: Arabic DEMO converted (17 items), math kids sample (12 items, id+en, one gem); `rules.arab.json` / `rules.mat.json`; `.editorconfig`; ktlint report-only until P3. Rules CR-ENG-10/11 added; gate now includes `validatePacks`. PARITY.md lists every divergence (reviews, gem, zone-aware dates, `not_assessed`, type/variant mapping).
- **Why:** Umar asked to continue with P1 while P0 is unverified; both phases will be verified by the same first Windows gate.
- **Verified by:** static only — both packs pass a Python mirror of the validator; all project-internal imports resolve; catalog aliases resolve. 7 Kotlin test classes (~70 cases) are written but have never run.
- **Verify on Windows (after the P0 list):** (1) sync — expect possible nits: `explicitNulls` opt-in, `compareBy` type args, `Mutex.isLocked` import, `@Serializable` on nested enums; fix in place and note here; (2) `./gradlew :core:model:test :core:content:test :core:engine:test :core:content:validatePacks`; (3) if `SessionTest` "second session" or "out of fresh" fail, check ReviewScheduler ordering first (PARITY.md explains the adapted expectations); (4) measure coverage on engine/content (target ≥ 90 %, CR-REL-3) with `jacoco` or Studio; (5) stamp COMPILED here, FILE_MAP and PARITY.md; (6) approve P2 scope (Room/DataStore/export).
- **Open:** Noto Naskh Arabic TTF still to bundle; `:core:engine` coverage tool not yet configured; whether casual tracks should insert REMED follow-ups at all (currently yes, same as evidence).
- **Observed after writing:** Umar opened `android/` in Android Studio on 2026-10-16 ~16:28–16:33 (local.properties, `.gradle/8.14.3`, debug class files in all 8 modules incl. Hilt-generated code). So the catalog versions resolve and **P0 compiles** (`compileDemoDebugKotlin` level); no test reports, lint or APK yet, and that build predates the P1 files (16:56). P0 stamp → COMPILED (compile only); P1 remains IN SOURCE until the gate runs.

## 2026-10-16 (follow-up 4) — P0 Foundations written (IN SOURCE, not compiled)

- **Change:** `android/` Gradle project with 8 modules per CR-ARC-1, version catalog, wrapper 8.14.3, Hilt app shell, type-safe nav, Home placeholder (id/en, demo banner), `AyaTheme` tokens from ART_DIRECTION, `PaperBackground`, `AyaButton`, model enums for the activity catalog, `Clock`/`Rng` with tests, `PackMeta`/`PackValidator` with tests, `DataModule`, `Product`/`Entitlements`, `app_config.json`, placeholder icon. `app/` → `prototype-expo/` via `git mv`; `.gitignore` Android section; `.gitattributes`. CI workflow + PR template written but **not in the repo** (`.github/` is protected from remote writes). Root README rewritten for the layout. FILE_MAP "Build identity" filled; CR-REL-2 gate commands now use the `demo` flavor.
- **Why:** Umar asked to start building; P0 per BUILD_PLAN. Versions pinned conservatively because the SDK manager was unreachable from this session.
- **Verified by:** static checks only — 38 catalog aliases resolve, all 8 modules have build files, id/en string keys identical, every `R.string` reference exists, all manifest resources exist. No Gradle run.
- **Verify on Windows (Claude Code or Android Studio, in order):** (1) copy `.github/workflows/android.yml` and `.github/pull_request_template.md` from the session files into the repo; (2) `git add --renormalize .` then one commit `chore: normalize line endings` (expect the 55-file CRLF noise to collapse); (3) `git update-index --chmod=+x android/gradlew`; (4) open `android/` in Android Studio, let it sync — if any catalog version is unavailable, bump it and record the final set in FILE_MAP; (5) run the CR-REL-2 gate; (6) install `demoDebug` on a device: paper background, "Sesi hari ini", demo banner, Start disabled; switch system language to English and confirm "Today's session"; (7) stamp COMPILED / DEVICE-TESTED here and in FILE_MAP, then approve P1 scope.
- **Open:** signing config (new keystore, CR-REL-5); Noto Naskh Arabic TTF to bundle in P1; whether to enable Gradle configuration cache after the first green build.

## 2026-10-16 (follow-up 3) — Build plan written; build environments checked (PLANNED; nothing compiled)

- **Change:** `docs/BUILD_PLAN.md` with phases P0–P9, gates and the cloud-writes / Windows-compiles working model; PROJECT_OVERVIEW points to it. Proposed skill `ayailmu-dev-session` (session protocol as a skill).
- **Found:** cloud container has JDK 21 + Gradle 8.14 but 403 to dl.google.com / maven.google.com / services.gradle.org; local Linux VM has JDK 11, same 403, no SDK. Therefore no Android compile outside the Windows machine. Account has no plugins enabled; connected connectors (Supabase, Vercel, Sentry, Slack, Netlify, Resend, MongoDB) are irrelevant to AyaIlmu; registry has no GitHub or Play Console connector.
- **Verified by:** `java -version`, `curl` to the three hosts in both environments; ListPlugins/ListConnectors.
- **Open:** Umar to confirm P0 scope and the `app/` → `prototype-expo/` move; install Claude Code + Kotlin LSP plugin on the Windows machine before the first gate.

## 2026-10-16 (follow-up 2) — Syllabus enriched (essentials + hidden gems); docs cleaned up (DRAFT docs; nothing compiled)

- **Change:** Framework gained an essentials checklist (§1a) and the "Permata / Gems" mechanic (§1b: `gem: true` items, once per step at a random position, Gem box, gems feed the daily puzzle, every gem needs a `source`). All four subject files rewritten as v2: 3–7 added units per level (e.g. phonics and listening, pocket money, negative numbers, first-aid awareness, food safety, civic processes, personal finance, regional histories, copyright) and 5–8 sourced gems per level for kids and adults. Docs: deleted `docs/Source_Copy_Manifest.json`; Trial_App_Spec §3/§12/§13/§15/§16 replaced with pointers to ai-memory; plan's platform/framework/business rows and §10 file list updated; repo README rewritten for AyaIlmu.
- **Why:** Umar asked for essentials and hidden-gem coverage, and for docs not to repeat what ai-memory already holds.
- **Verified by:** activity-id scan against the catalog (all ids valid), budget check, docs sizes; content facts are drafts until reviewers verify each `source`.
- **Open:** reviewer-flagged units (kids Sains "Tubuhku bertumbuh", kids Sosial "Aman & berani bicara", regional histories) need the named reviewers before authoring; gem facts marked "contested/debated" in text must keep that wording.

## 2026-10-16 (follow-up 1) — Syllabus for 4 subjects × kids/adults × 4 levels; bilingual decided (DRAFT docs; nothing compiled)

- **Change:** Added `docs/syllabus/` (framework + 4 subject files, FILE_MAP rows). Decisions: UI *and* all content in ID + EN (CODE_RULES §11, CR-I18N-1..6); kids = readers 7–12; language tracks: Arab now, Inggris + Bahasa Indonesia Literasi next, Indonesian for English speakers (adults), JP/KR/ZH planned only. Activity catalog grew to 19 types; CR-ENG-5 now maps catalog ids to v1 renderers and names the v2 ones; CR-ENG-9 keeps practice-only types out of evidence and speed rounds off for young kids. Milestone M7 added.
- **Why:** Umar asked for varied, fun, non-boring activities per level and a bilingual system; the catalog + "five types per unit" rule operationalises "fun", CR-HAB keeps it honest.
- **Verified by:** not verified — docs only; budgets checked with `check_budget.py`.
- **Open:** confirm the reading of Umar's language picks (Arabic built now, EN/ID syllabus ready, JP/KR/ZH later); kids Arabic track needs its own reviewer; every pack needs an EN reviewer in addition to ID and subject reviewers.

## 2026-10-16 — Project reframed as AyaIlmu; ai-memory created (DECIDED; nothing compiled)

- **Change:** Repo repurposed from "Arabic trial prototype" to AyaIlmu, a four-subject Android-native learning app for kids and adults. Decisions taken in session: Kotlin + Jetpack Compose; Arabic course = first track inside AyaIlmu; freemium with one-time lifetime unlocks via Play Billing, no ads; kids and adults together at launch (Play Families policy applies in full); no backend of our own, data stays on device, trial answers exported by share sheet instead of uploaded.
- **Why:** Umar's three concerns — sustainable AI guidelines, human-made visuals, zero hosting cost while still monetisable. Kotlin/Compose matches AyaKasir skills; Play Billing gives server-free entitlements; Families compliance is simplest with no ads and no third-party SDKs.
- **Memory design:** Reused AyaKasir's conventions (newest-first, dated, status-stamped) but added byte budgets per file, a fixed stamp vocabulary, numbered rule IDs, one-fact-one-file, and this compaction rule — AyaKasir's SESSION_LEARNINGS had reached 2.3 MB / 726 sections, which no session can read.
- **Visuals:** No catalogue skill produces "human-made" art; instead ART_DIRECTION.md defines the standard (hand-drawn pillars, anti-slop checklist, illustrator-led pipeline, Rive/Compose motion rules) and a Claude skill `ayailmu-art-direction` was proposed so every future session applies it.
- **Verified by:** not verified — no code written; Android project does not exist yet (M0 pending).
- **Open:** move `app/` → `prototype-expo/`; remote config override yes/no; pack prices; illustrator; package id; Play Families self-review before the first closed test.
- **Housekeeping found:** `git status` shows all 55 tracked files modified with equal insertions/deletions — CRLF/LF line-ending drift between the commit and the Windows checkout, not real changes. At M0 add `.gitattributes` (`* text=auto eol=lf`), run `git add --renormalize .`, commit once as `chore: normalize line endings`.

## 2026-10-18 — Amar WIP checkpoint (IN SOURCE)

Separate RN, local backend and earlier integration snapshots are preserved on named branches. `docs/Amar_WIP_Handoff.md` records exact scope and remaining13 RN sync contracts. No main merge, native release, deployment or completed-app claim accompanies this checkpoint.
