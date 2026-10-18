# Project Overview — AyaIlmu

Budget: ≤ 12 KB. Newest decisions first. One fact lives in one file; link, don't copy.
Status stamps used everywhere: **PLANNED · IN SOURCE (not compiled) · COMPILED · DEVICE-TESTED · RELEASED vX · DROPPED**.

## What AyaIlmu is (DECIDED 2026-10-16)

Android-native learning app by PT Petalytix Teknologi Indonesia for people who want to spend free time learning and keeping skills sharp. Six modules: **Bahasa (one module, languages Arab/Inggris/Korea/Jepang/Mandarin), Matematika, Sains, Sosial & Seni, Nilai (universal values, free) and Sejarah (noble people of history, animated stories)** — each with Pemula/Menengah/Mahir/Master per audience (DECIDED 2026-10-18). Feel: fun, light, worth coming back to every day — through delight and visible progress, never through guilt, timers or fake scarcity (see CODE_RULES §Healthy habit loop).

Audience: **kids and adults together at launch** (DECIDED 2026-10-16). Two profile kinds on one device: Adult and Anak (child, created by a guardian). Kids track targets **readers, about 7–12 (SD)**; pre-readers are out of scope for v1 (DECIDED 2026-10-16).

**Bilingual by design (DECIDED 2026-10-16):** UI *and all learning content* exist in Bahasa Indonesia and English. App language = instruction language, chosen per profile. Content model and validator rules: CODE_RULES §11; track table: `docs/syllabus/00_FRAMEWORK.md` §5.

**Syllabus (DRAFT 2026-10-16):** `docs/syllabus/` — framework (levels Pemula/Menengah/Mahir/Master for kids and adults, 19-type activity catalog, session composition) plus one file per subject. Language tracks: Arab (built now, reviewed curriculum), Inggris and Bahasa Indonesia (full syllabus, build next), Indonesian for English speakers (adults), Jepang/Korea/Mandarin (Pemula drafts since 2026-10-18, `docs/syllabus/bahasa/`).

Mascot: **Aya** — the same character family as the "Aya" coach bubble in AyaKasir, so Petalytix products share one face. Drawn by hand; see ART_DIRECTION.md.

## Hard constraints (DECIDED 2026-10-16)

1. **No backend of our own.** No online database, hosting, auth service, analytics SDK or push service. Everything a learner does lives on the device (Room + DataStore). The only online services are Google Play (distribution, Play Billing, Android Vitals) and an *optional* static config file on a free static host (OPEN; see CODE_RULES §Config).
2. **Monetization still reliable:** freemium with one-time lifetime unlocks via Play Billing, entitlement verified and restored by Play on-device. No ads. Details: MONETIZATION_SCHEME.md.
3. **Nothing visual may look machine-made.** Every illustration, animation and video follows ART_DIRECTION.md. AI image generators never produce shipped assets. Voice: pronunciation clips may come from ElevenLabs (DECIDED 2026-10-18, CR-SND-2); no other AI voice or video.
4. **Umar decides, Claude proposes.** No architecture, pricing or content-policy change is implemented before Umar approves it in the session.

## Stack (DECIDED 2026-10-16)

Kotlin + Jetpack Compose (Material 3 as the base, heavily themed), Room, Proto DataStore, Hilt, Coroutines/Flow, kotlinx.serialization, Play Billing Library 8+, Rive runtime for character/mascot animation, Lottie only for simple decorative loops. Same family as AyaKasir, so rules and habits transfer. Exact versions are pinned in `android/gradle/libs.versions.toml` and mirrored in FILE_MAP.md once the project exists. iOS: not planned; the engine is a pure Kotlin module so KMP stays possible later.

## Relationship to the Arabic trial (DECIDED 2026-10-16)

The Arabic course in `docs/` (Arabic_Course_Current_Plan.md, Lessons_Unit_A_B_Draft.md, Trial_App_Spec.md) becomes **the first track inside AyaIlmu**: Bahasa → Arab. Its learning rules (fresh evidence, "learned" thresholds, D7/D30 checks, pools, review spacing) are implemented once in the shared engine and switched on per track via config; casual tracks (math drills, science, social & arts) use lighter rule sets from the same engine.

`prototype-expo/` (moved from `app/` on 2026-10-16) is the **Expo/React Native prototype** (TypeScript, 93 Jest tests, SQLite). It is reference material for the Kotlin port, not the product. Its scoring/freshness/session tests are the parity baseline for `:core:engine`; delete it only after the Kotlin engine passes the ported test suite.

Spec deviations forced by "no backend" (DECIDED 2026-10-16, replaces Trial_App_Spec §12–13 upload/sync):
- Answers are never uploaded. Testers export a JSON/CSV bundle from Settings via the Android share sheet (email/WhatsApp to the team). Human-check of typed answers happens in a spreadsheet; recompute tool runs on the exported files.
- Rule config ships bundled and versioned; an optional static-file override may be fetched when online (OPEN). Never required for the app to work.
- Content review gating stays: only `review_status = approved` items are visible outside developer mode.

## Play policy posture (DECIDED 2026-10-16)

Target audience declared as mixed (children + adults) → Google Play Families policy applies in full: neutral age screen at onboarding, no ads at all (so no ad-SDK certification needed), no third-party SDK that collects data from children (hence no Firebase/Sentry/analytics in the kids path — crash data comes from Android Vitals only), no AAID/IMEI/MAC access, no location, Play Billing only, purchase flow behind an adult gate on Anak profiles, no manipulative purchase prompts, real money always labelled as real money (no virtual currency). Privacy policy and Data Safety form must say "data stays on device". Teacher Approved opt-in: OPEN, after launch.

Store accounts already exist (AyaKasir publishes on Play). Closed testing with ≥ 12 testers for the Arabic track is still the plan before production.

## Milestones (PLANNED 2026-10-16) — detailed phases P0–P9, environments and gates: `docs/BUILD_PLAN.md`

**Where code is built (checked 2026-10-16):** cloud Cowork sessions and the Linux VM on Umar's PC cannot reach Google's Maven/SDK hosts (403) and have no Android SDK, so they produce source stamped IN SOURCE; compilation, tests and device runs happen in Claude Code / Android Studio on the Windows machine. No connectors are required for this project.

| # | Milestone | Exit criterion |
|---|---|---|
| M0 | Android project skeleton, modules, CI gates, ai-memory live — **P0 DEVICE-TESTED 2026-10-17** (demo build on Umar's phone; gate tests/lint not yet run) | CR-REL-2 gate green locally and in CI; empty app launches on a device |
| M1 | `:core:engine` ported from TS with parity tests; content schema v1; Arabic demo pack loads — **P1 COMPILED 2026-10-17** (built as part of the app), suite never run; **P2 data layer COMPILED 2026-10-16** (Room schema generated; tests not yet run) | Ported suite green; `validatePacks` green; synthetic DEMO pack runs a full session on device (P3) |
| M2 | Core loop UI: onboarding + age screen, profiles, home "Sesi hari ini", session, feedback, summary, progress — **P3a playable loop + P3b (settings, progress, Arabic consent, daily reminder, screenshot tests) IN SOURCE 2026-10-17**; P3 gate pending (Windows run + device test) | DEVICE-TESTED on a low-end phone and a tablet |
| M3 | Hand-made visual layer: style bible from illustrator, Aya rig in Rive, 30+ spot illustrations, motion rules applied — **P4 DRAFT set (187 Claude vector drawings) + integration IN SOURCE 2026-10-17**; illustrator redraw/approval open | ART_DIRECTION acceptance checklist passes per asset |
| M4 | Play Billing: packs + all-access, adult gate, restore, offline entitlement cache — **P5 IN SOURCE 2026-10-17**; Play Console products and test purchases open | Test purchases pass incl. airplane-mode launch |
| M5 | Arabic closed test (approved content only, audio bundled, export works) — **P7 kit IN SOURCE 2026-10-17** (reports, surveys, tester codes, store drafts in `docs/store/`); approved items, audio, Play setup open | ≥ 12 testers, 14 days, no P0 |
| M6 | First casual tracks (Matematika Pemula kids+adults, one Sains unit, one Sosial & Seni unit) + kids profile content, both languages — **P8 draft packs IN SOURCE 2026-10-17** (Matematika Pemula 10 units each audience; Sains and Sosial & Seni 5 units each audience; unreviewed) | Families policy self-review passed; production release |
| M7 | Inggris track Pemula–Menengah (kids + adults), Bahasa Indonesia Literasi Pemula — **Pemula 01–05 drafts for Inggris, Korea, Jepang, Mandarin (kids + adults) + picture-first gestures, tracing and sound IN SOURCE 2026-10-18**; v2 renderers (tap_hotspot, estimate_slider, daily_puzzle — **built early in P6, IN SOURCE 2026-10-17**) | Reviewer-approved packs in ID+EN | **Follow-up 12 (2026-10-18): Menengah/Mahir/Master starter units for every module, audience and language, Nilai and Sejarah modules, module/level navigation — IN SOURCE, unreviewed.**

## Open decisions (for Umar)

- Optional static config override host (GitHub Pages recommended, free) — or no remote config at all for v1.
- Pack prices: DECIDED 2026-10-17 — the defaults in MONETIZATION_SCHEME.md, no upgrade product.
- Illustrator engagement (commission a style bible + core set; see ART_DIRECTION.md §Pipeline).
- App name on the store listing ("AyaIlmu" assumed), package id (`id.petalytix.ayailmu` assumed).
- Consent/deletion contact **support@petalytix.id** (DECIDED 2026-10-17): mailbox must exist on Rumahweb before the closed test. Trial data retention: deleted ≤ 6 months after the trial ends (DECIDED 2026-10-17). Consent text (v arab-trial-1) is a draft: legal review against UU PDP before the closed test (OPEN).
