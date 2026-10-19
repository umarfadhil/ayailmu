# AyaIlmu

> **Amar WIP checkpoint (2026-10-18): app not complete.** See [Amar WIP handoff](docs/Amar_WIP_Handoff.md) for this branch's scope, related branches and remaining account/sync work. This source checkpoint is not a release or deployment.

Android-native learning app by PT Petalytix Teknologi Indonesia: languages, mathematics, science, social studies & arts, for kids (7–12) and adults, in Bahasa Indonesia and English. Offline-first, no backend, hand-made illustrations, freemium with one-time unlocks.

**Start here:** [`ai-memory/README.md`](ai-memory/README.md) — reading order, decisions, rules, file map. Build phases: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).

## Layout

| Path | What |
|---|---|
| `android/` | The app: Kotlin + Jetpack Compose, Gradle modules `:app`, `:core:{model,engine,content,data,billing,design}`, `:content`. Open this folder in Android Studio |
| `ai-memory/` | Canonical project memory: overview, code rules, file map, monetisation, art direction, session learnings |
| `docs/syllabus/` | Learning syllabus: framework + one file per subject, kids and adults, four levels, activity catalog, hidden gems |
| `docs/Arabic_Course_Current_Plan.md`, `docs/Lessons_Unit_A_B_Draft.md`, `docs/Trial_App_Spec.md` | The reviewed Arabic course (first language track) and its trial behaviour spec |
| `prototype-expo/` | Expo/React Native **prototype** of the Arabic trial (TypeScript, 93 Jest tests). Reference for the Kotlin port only; see its README to run it |

## Build

```bash
cd android
./gradlew :core:model:test :core:engine:test :core:content:test :app:testDemoDebugUnitTest :app:lintDemoDebug :app:assembleDemoDebug ktlintCheck
```

Flavors: `demo` (shows unreviewed content behind a banner) and `prod` (approved content only). Status: P0 foundations in source, first gate pending; content in `docs/` is draft until reviewers approve it.
