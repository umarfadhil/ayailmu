# AyaIlmu Build Plan

> **Current scope (notice added 2026-10-17):** this is the plan for the Kotlin **Android** app only; the text below it is unchanged. The owner's launch direction is now Kotlin Android **and** Swift iOS (`ai-memory/PROJECT_OVERVIEW.md` §Platforms). No iOS plan exists yet, and nothing here covers iOS. P1's port from `prototype-expo/src/engine` covers the pre-four-choice prototype. Native Arabic still uses typed/binary v0.1; the latest four-choice Arabic v0.3 contract has not been ported and native parity is not established.

**Status:** PLANNED 2026-10-16. Phases map to the milestones in `ai-memory/PROJECT_OVERVIEW.md` (M0–M7) but are cut small enough that one phase = one well-produced piece of work with its own gate. Rules referenced as `CR-xxx-n` live in `ai-memory/CODE_RULES.md`. Umar approves the scope of each phase before it starts and signs its gate before the next one (CR-SES-2).

## 0. Where work happens (checked 2026-10-16)

| Environment | Can do | Cannot do |
|---|---|---|
| **Cowork cloud session** (this) | Write and edit every file in the repo via the device bridge; design, port, write tests, docs, content packs, briefs; run pure-JVM Kotlin only if Google's Maven were reachable — it is not (403), so in practice: no Gradle here | Compile Android, run Room/Compose tests, run an emulator |
| **Linux VM on Umar's PC** (`device_bash`) | grep/sed/python over the repo, git status/diff, content validation scripts in Python | Same network block (403 to dl.google.com); no Android SDK |
| **Claude Code on Windows** (Android Studio machine) | Everything: `./gradlew` builds, unit + screenshot tests, emulator/device runs, signing, `gh` for PRs; Kotlin LSP plugin for live diagnostics | — |

Working model: cloud sessions produce source stamped **IN SOURCE (not compiled)** plus a "verify" checklist at the end of the SESSION_LEARNINGS entry; a Claude Code Desktop session (or Umar in Android Studio) runs the gate commands (CR-REL-2) and upgrades the stamp. No phase closes from the cloud alone.

Setup that matters before P0: Claude Code installed on the Windows machine with the repo opened; JDK 17 and Android SDK already present from AyaKasir; Kotlin LSP plugin (KotlinSense or kotlin-lsp) enabled in Claude Code; the `ayailmu-art-direction` and `ayailmu-dev-session` skills saved on the account. No connectors are needed for this project; Figma only becomes useful if the illustrator delivers in Figma.

## 1. Phases

Effort is in sessions (≈ 2–4 focused hours each). Stamps are the CODE_RULES vocabulary.

### P0 — Foundations (1–2 sessions) → M0

**Produce:** `android/` Gradle project: `settings.gradle.kts`, version catalog (`libs.versions.toml` with Kotlin, AGP, Compose BOM, Room, Hilt, DataStore, kotlinx.serialization, Play Billing 8.x, Rive, test libs — versions chosen on the Windows machine where the SDK manager works), modules `:app :core:model :core:engine :core:content :core:data :core:billing :core:design :content` (CR-ARC-1), Hilt wiring, empty `AyaTheme` with tokens, `strings.xml` id + en skeleton, build flavors `developerDemo` / `release`, ktlint, `.gitattributes` + line-ending normalisation commit, `.gitignore` for Android, `app/` → `prototype-expo/` move (after Umar confirms), GitHub Actions workflow running the CR-REL-2 gate on push, PR template with the ART_DIRECTION checklist link, FILE_MAP "Build identity" filled.
**Gate:** `./gradlew :app:testDebugUnitTest :app:lintDebug assembleDebug` green locally and in CI; empty app launches on a device showing the theme's paper background. Stamp COMPILED → DEVICE-TESTED.

### P1 — Content model & engine port (2–3 sessions) → M1

**Produce:** `:core:model` data classes; `:core:content` schema v1 (bilingual strings, 19 catalog types with v1/v2 flags, pools, skills, `gem`, `review_status`, `audience/level/unit/step`, item-ID scheme from the framework §7), validator as a Gradle task (`validatePacks`: both languages present, IDs unique and immutable, only valid types, gems have `source`); `:core:engine` ported from `prototype-expo/src/engine` **tests first** (CR-ENG-8) — scoring, freshness, session planner, skill projection from `AnswerEvent`s, `RuleConfig` for `evidence` and `casual` modes, injected `Clock`/`Random`; `PARITY.md`; packs: Arabic DEMO pack converted from `demo-unit-a.json`, `rules.arab.json` from the prototype's `rules.json`, a 12-item Matematika Pemula sample pack in both languages to exercise casual mode.
**Gate:** ported suite green with ≥ 90 % coverage on engine and content (CR-REL-3); `validatePacks` passes; a scripted session replay produces the same skill states as the TS prototype for the DEMO pack.

### P2 — Data layer (1–2 sessions)

**Produce:** Room schema v1 — `Profile`, `AnswerEvent`, `SkillState`, `SessionLog`, `ItemReport`, `GemCollected`, `ContentVersion`; Proto DataStore for settings and entitlement cache; repositories with Flow; exported schemas + migration test harness (CR-DAT-1); export to JSON + CSV via share sheet and delete-all (CR-DAT-4); `dataExtractionRules` for auto-backup (CR-DAT-6); profile `instructionLang` and per-app locale wiring (CR-I18N-2).
**Gate:** repository tests green; export file opens in a spreadsheet; backup/restore verified on a device by reinstalling.

### P3 — Core loop UI (3–4 sessions) → M2

**Produce:** `:core:design` tokens, typography (incl. Noto Naskh Arabic), components (`AyaButton`, `OptionCard`, `TileTray`, `MatchBoard`, `ProgressLine`, `GemCard` placeholder art); screens: welcome, neutral age screen, profile create (Adult / Anak from Adult), consent (Arabic track adults), home "Sesi hari ini", session runner with the 9 v1 renderers, feedback and "Saya belum tahu", interim and final summary, progress (three honest lines / mastery bar), settings (text size, session length, language, reminder, export, delete, learner_id), developer-demo screen; `@Preview`s light/dark/fontScale 1.5 (CR-KT-3); screenshot tests in id and en (CR-I18N-6); TalkBack labels (CR-A11Y-1).
**Gate:** full Arabic DEMO session and the math sample run end-to-end on a low-end phone and a tablet (DEVICE-TESTED); screenshot baselines committed; no string hard-coded (lint rule).
**Split (DECIDED 2026-10-17):** **P3a — playable loop** (IN SOURCE 2026-10-17): first-run onboarding (language, neutral birth year, nickname; under-13 → parent), profile switcher + add profile (child only from an adult), Home shelf filtered by language/audience with Resume, session runner with lesson cards, all 9 v1 renderers, "Saya belum tahu", feedback, gem card, counts-only summary; components `OptionCard`, `TargetText`, `AyaSecondaryButton`, `AyaTextField`, `SessionProgressBar`, `PaperCard`. **P3b — rest of the loop** (IN SOURCE 2026-10-17; reminder built now, Roborazzi chosen for screenshots — DECIDED 2026-10-17): progress screen, settings (text size incl. Arabic scale, session length, language, reminder, export, delete, learner_id), Arabic consent screen, interim summary, screenshot tests id/en, TalkBack/fontScale 2.0 pass, ktlint enforced. The P3 gate above applies after P3b; P3a has its own mini-gate: app unit tests green + one full math session (child profile) and one Arabic session (adult, Indonesian) on the phone.

### P4 — Hand-made visual layer (2 sessions of integration; illustrator timeline is separate) → M3

**Produce:** intake of the style bible (palette tokens, texture overlays, type pairing) into `AyaTheme`; replace placeholder art with the core set; Aya Rive rig integrated with state-machine inputs (`idle`, `onCorrect`, `onNotYet`, `onSessionDone`, `sleep`), reduce-motion still pose (CR-A11Y-2); `AyaMotion` easing set; sticker shelf and level scenes; store screenshots pipeline.
**Gate:** every shipped asset passes the ART_DIRECTION §7 checklist (linked in PRs); app icon final; screenshot tests re-baselined.

### P5 — Billing & store (1–2 sessions) → M4

**Produce:** `:core:billing` on Play Billing 8.x: products from MONETIZATION_SCHEME, `queryPurchasesAsync` on start/resume, acknowledge, `PENDING` handling, local signature check, DataStore entitlement cache (CR-BIL-1..6); store screen with Play-formatted prices; adult gate on Anak profiles; restore button; Play Console: products created, licence testers, internal testing track.
**Gate:** test purchases for each product pass; airplane-mode launch keeps entitlements; refund in Play Console revokes on next online start.

### P6 — v2 renderers, gems, daily puzzle (2 sessions)

**Produce:** `tap_hotspot`, `estimate_slider`, `memory_flip`, `story_choice`, `speed_round` (opt-in, CR-ENG-9), `daily_puzzle` wrapper; gem mechanic (once per step, Gem box, gem pool feeds the daily puzzle); unit challenge → sticker; level scene fill.
**Gate:** each type has schema + renderer + scoring + fixture + test (CR-ENG-5); a kids profile never sees a speed round below Mahir (test).

### P7 — Arabic closed test readiness → M5

**Produce:** import of reviewer-approved Arabic items (only `approved`), ~75 entry-check audio clips bundled, "Kalimat latihan buatan" labels, report-this-item flow, surveys at day 7 and end, export verified end-to-end with the human-check spreadsheet; privacy policy page on petalytix.id matching the Data Safety form ("data stays on device"); Play Families self-review checklist completed; internal → closed testing with ≥ 12 testers.
**Gate:** Trial_App_Spec §14 acceptance checks pass; closed test running 14 days with no P0.

### P8 — First casual tracks & production (3–4 sessions) → M6

**Produce:** Matematika Pemula (kids + adults) full packs in ID + EN with gems; one Sains and one Sosial & Seni unit each audience; listing copy and screenshots; production release.
**Gate:** reviewer-approved packs; Families policy self-review; production rollout at 20 % → 100 %.

### P9 — Growth (ongoing) → M7+

Inggris Pemula–Menengah (kids + adults), Bahasa Indonesia Literasi Pemula, more math/science/social levels, Play Pass application, cross-promo in AyaKasir, optional static config override (OPEN), kids Arabic track once its curriculum is reviewed.

## 2. Parallel tracks that don't block code

- **Illustrator:** brief and style bible (ART_DIRECTION §5) should start during P0–P1 so P4 has material.
- **Reviewers:** Arabic + Indonesian reviewers on `Lessons_Unit_A_B_Draft.md` now; English reviewer recruited before P8; subject reviewers for math/science/social before their packs.
- **Audio:** entry-check recording after Arabic review approves the items.
- **Store prep:** privacy policy draft, Data Safety answers, Families questionnaire can be written during P5.

## 3. Phase gate ritual

At the end of each phase: run the gate commands and paste the output into the SESSION_LEARNINGS entry; update FILE_MAP stamps; Umar signs off in the session; the next phase's scope is confirmed in one message before any file is touched.
