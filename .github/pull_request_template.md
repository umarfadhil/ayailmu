## What

<!-- One paragraph. Which BUILD_PLAN phase, which CODE_RULES ids this touches (e.g. CR-ENG-5, CR-I18N-1). -->

## Stamp

- [ ] IN SOURCE (not compiled) — written without a Gradle run
- [ ] COMPILED — gate green locally (paste the command + last lines below)
- [ ] DEVICE-TESTED — low-end phone + tablet

```
./gradlew :core:model:test :core:engine:test :core:content:test :core:content:validatePacks :app:testDemoDebugUnitTest :app:lintDemoDebug :app:assembleDemoDebug ktlintCheck
```

## Checklists

- [ ] Every learner-facing string exists in `values/` (id) and `values-en/`, or as `{id, en}` in packs (CR-I18N-1)
- [ ] New/moved files have a row in `ai-memory/FILE_MAP.md`
- [ ] Anak-profile path: no timers, no manipulative copy, purchases behind the adult gate (CR-HAB-6, CR-BIL-5)
- [ ] Visual assets: ART_DIRECTION §7 acceptance checklist passed (link or N/A)
- [ ] `SESSION_LEARNINGS.md` entry added (≤ 12 lines) and `check_budget.py` green
