# AyaIlmu

> **Amar WIP checkpoint (2026-10-18): app not complete.** See [Amar WIP handoff](docs/Amar_WIP_Handoff.md) for this branch's scope, related branches and remaining account/sync work. This source checkpoint is not a release or deployment.

Native learning app by PT Petalytix Teknologi Indonesia: languages, mathematics, science, social studies & arts, for kids (7–12) and adults, in Bahasa Indonesia and English. Offline-first, hand-made illustrations, freemium with one-time unlocks.

**Start here:** [`ai-memory/README.md`](ai-memory/README.md) — reading order, decisions, rules, file map. Android build phases: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).

## Status (2026-10-17)

Nothing is released, and no platform is ready for a learner beta: see [`docs/Private_Beta_Readiness.md`](docs/Private_Beta_Readiness.md).

- **Launch direction (owner, recorded 2026-10-17):** a native Kotlin **Android** app and a native Swift **iOS** app at launch. Decisions and open questions: [`ai-memory/PROJECT_OVERVIEW.md`](ai-memory/PROJECT_OVERVIEW.md).
- **Android (`android/`):** Kotlin source exists. P0 was device-tested on one phone; P1–P2 compiled; P3a/P3b exist in source only (stamps: PROJECT_OVERVIEW §Milestones). No green run of the CR-REL-2 gate (Gradle tests, lint, ktlint) is recorded, and the P3 device gate is pending.
- **iOS:** the Swift app is **not implemented**. There is no source, project, build or device evidence.
- **Expo prototype (`prototype-expo/`):** the **reference prototype**, not the release product. It is a local Arabic-trial loop for Indonesian-speaking adults with guided lessons, four-choice practice with feedback, spaced reviews, timed D7/D30 checks, factual progress, settings and session summaries. On the 2026-10-17 integration tree, 23 Jest suites / 381 tests pass, as do TypeScript and Expo lint (Node 22.16.0). That says nothing about native release readiness. The complete pilot is not built.
- **Backend:** this integration contains no backend implementation. A separate local Go/PostgreSQL/Firebase workstream was approved on 2026-10-17; see PROJECT_OVERVIEW.
- **Content:** every bundled pack (Expo and Android) is synthetic and unreviewed. The Arabic course documents are drafts that no qualified Arabic or Indonesian reviewer has approved. The prototype's active pack `demo-synthetic-0.3` is recognition-only, its tester mode shows no lessons, and mastery is not assessed while the four-choice "learned" rule is undecided.

## Layout

| Path | What |
|---|---|
| `android/` | The Android app: Kotlin + Jetpack Compose, Gradle modules `:app`, `:core:{model,engine,content,data,billing,design}`, `:content`. Open this folder in Android Studio |
| *(no folder yet)* | The Swift iOS app: not implemented |
| `ai-memory/` | Canonical project memory: overview, code rules, file map, monetisation, art direction, session learnings |
| `docs/syllabus/` | Learning syllabus (draft): framework + one file per subject, kids and adults, four levels, activity catalog, hidden gems |
| `docs/Arabic_Course_Current_Plan.md`, `docs/Lessons_Unit_A_B_Draft.md`, `docs/Trial_App_Spec.md` | The Arabic course plan and lesson drafts (first language track; not yet checked by qualified reviewers) and the trial behaviour spec |
| `docs/Four_Choice_Content_Review.md` | Key and distractor rationale for the prototype's synthetic four-choice pack; no reviewer sign-off |
| `docs/Private_Beta_Readiness.md` | Readiness gates per platform; the 2026-10-16 Expo-only checklist is kept there as history |
| `docs/Premium_Feel_Audit.md`, `docs/superpowers/` | Historical records: the 2026-10-16 premium-feel audit of the prototype and the 2026-10-15 four-choice plan and spec. Their `app/` paths are the prototype's pre-move folder |
| `prototype-expo/` | Expo/React Native **reference prototype** of the Arabic trial (TypeScript, Expo Router, SQLite). Not the release product; see its README to run it |

## Build and test

Android, from `android/`. This is the CR-REL-2 gate in `ai-memory/CODE_RULES.md`:

```bash
cd android
./gradlew :core:model:test :core:engine:test :core:content:test :core:content:validatePacks :core:data:testDebugUnitTest :app:testDemoDebugUnitTest :app:lintDemoDebug :app:assembleDemoDebug ktlintCheck
```

Flavors: `demo` shows unreviewed content behind a banner; `prod` shows approved content only, and no bundled pack is approved yet.

Expo prototype: run from `prototype-expo/`. The commands are in [`prototype-expo/README.md`](prototype-expo/README.md).
