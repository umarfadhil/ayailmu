# Engine parity notes

The Kotlin engine is ported from the Expo prototype (`prototype-expo/src/engine/*.ts`, tests in
`prototype-expo/src/engine/__tests__/`). Port order (CR-ENG-8): tests first, then code. Every intentional
divergence is listed here so the TS prototype can be deleted with confidence once the Kotlin suite is green.

## Test mapping

| Prototype suite | Kotlin test | Status |
|---|---|---|
| `scoring.test.ts` (normalize, levenshtein, Q-MEAN, Q-PARA, Q-FORM2, config) | `ScoringTest` | ported 1:1 + casual types |
| `freshness.test.ts` (order, READY, D7/D30, REMED, exclude, later_day, FOCUS, reserved forms, clashes) | `FreshnessTest` | ported 1:1 + audience, v2 filter |
| `session.test.ts` (flow, double submit, follow-ups, out-of-fresh, budget, JSON round trip, second session, summary) | `SessionTest` | ported; two cases adapted (below) |
| `controller.test.ts` (double submit, failed answer write, failed snapshot write, resume, screens seen) | `SessionControllerTest` | ported 1:1 |
| `gating.test.ts` (demo/tester gating, validation) | `PackValidatorTest` (:core:content) | ported 1:1 + bilingual, gems |
| — | `ProjectionTest` | new: ReviewScheduler, SkillProjector |

## Intentional divergences

| Area | Prototype | Kotlin | Why |
|---|---|---|---|
| Time | `Date.now()`, device TZ | `Clock` + explicit `ZoneId` stored in the snapshot | CR-ARC-3 determinism; "later day" is zone-correct |
| Randomness | none (planner deterministic) | `Random` injected; used only for the gem position | replayable sessions |
| Ids | `newId()` UUID | `IdGenerator` (UUID in prod, counting in tests) | deterministic tests |
| Item types | `q-mean`, `q-para`, `q-form2`, `q-ref`, `choose` | catalog `type` + `variant` (`type_in/meaning`, `type_in/paraphrase`, `choose/form`, `choose/referent`) | one catalog for all subjects (CR-ENG-5) |
| Strings | Indonesian only | `LocalizedText {id,en}`; `accepted` keyed by language; typed-rule word lists per language | CR-I18N |
| Review status | `draft/reviewed-arabic/reviewed-indonesian/approved-for-trial` | `draft/reviewed_subject/reviewed_language/approved` | subject-neutral |
| App mode | `rules.mode` = developer-demo/tester | build flavor `demo`/`prod`; `rules.mode` now means evidence/casual | CR-ENG-2, CR-ENG-4 |
| Planner | screens → PRACT items (1/min) | screens → due **reviews** (capped by `review_share_max`) → PRACT (`items_per_minute`) → one **gem** at a random position | framework §4; prototype left reviews for later |
| `session.test` "second session" | expected no seen item queued at all | same day: unchanged; next day: seen items may appear only as `REVIEW` steps within the cap | reviews are by definition seen items |
| `session.test` "out of fresh" | seen REMED items dated the day before | dated the same day | with the scheduler, yesterday's items would be due reviews and change the queue order |
| Evidence flag | `pool != INSTR && != FOCUS` | also excludes GEM pool and practice-only types (`memory_flip`, `speed_round`, `info_card`) | CR-ENG-9 |
| Outcomes | 4 outcomes | + `not_assessed` (audio failure, info cards/gems); summary ignores it | spec §5 |
| Controller store | `Store` with learner object | `SessionStore` (recordAnswer atomic, saveSnapshot, saveScreensSeen) | Room-backed in P2 |
| Skill states | not implemented | `SkillProjector` (evidence + casual rules, binary streak, blocked-by-serious, words) | spec §7 / framework §3; first suspect when a progress number looks wrong |

Status: P1 — IN SOURCE (not compiled). Gate: `./gradlew :core:model:test :core:engine:test :core:content:test :core:content:validatePacks`.
