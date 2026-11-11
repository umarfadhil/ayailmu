# Next lesson integration: nominal definiteness (design)

Base: `147ce7e` on `feature/nominal-definiteness-integration-20261025`. Local developer-demo only. Content
(`app/src/content/increments/nominal-definiteness/content.ts`) stays exactly as reviewed: data, prose, IDs and
`review_status`/`human_review`/`integration` flags are not changed. Outcomes are descriptive only. Nothing here
claims mastery, an unlock, retention or efficacy.

## Flow
Unit A `progress` view with `provisional === true` (that is, `anchorOf` → `canAdvanceUnitA`) → entry button →
route `/next-lesson` → 4 teaching screens (`lessons[0].screens`, in order) → 6 `phase:'practice'` items (in content
order, 4 shuffled options, first choice saved before immediate feedback) → 4 `phase:'transfer'` items, offered
only on a later day that has no assistance, with grading deferred until the 4th answer → closed view showing counts
`{answered, correct, valid}`.

## Qualification (read-only, no second threshold)
- New export in `app/src/pilot/unitA/controller.ts`:
  `unitAStatus(raw: string | null, owner: string, today: string): { qualified: boolean; days: string[] } | null`.
  It runs `parseDoc` → `anchorOf(doc, PLAN) !== null`, and `days` = the distinct `daysOf(doc)` days, sorted. It
  returns `null` for an invalid owner or calendar day (checked before parsing), when PLAN is null, or when the doc
  is blocked (owner, schema, version, future-day, corrupt). It is pure: no `settle`, no `load`, no assistance read,
  no write, so d7 can never open as a side effect. Qualification stays true while a d7/d30 question is active and
  after a wrong delayed answer, because delayed answers never move the anchor.
- Also export `pilotQueueFor(store)` (the existing private `queueFor`), so next-lesson operations are serialised
  with pilot operations and reset.
- The next-lesson controller reads `store.getMeta(PILOT_META_KEY)` inside its own `updateMeta` transform on
  every operation (load/next/answer) and blocks with `not-qualified` unless `qualified`. No boolean is ever
  persisted. An anchor never moves after it is set, so qualification can only disappear through a reset,
  corruption or a different owner. In that case the next lesson blocks and leaves its document untouched.

## Next-lesson controller (`app/src/pilot/nextLesson/controller.ts`)
- Key `NEXT_LESSON_META_KEY = 'pilot_next_nominal_definiteness'`. It is a separate namespace and never touches
  `saveAnswer`, screen-view logging, legacy answer registries or snapshot registries.
- Doc (strict `exactly` keys): `{owner, schema:1, contentVersion, screens:{screenId, shown[], completed}[],
  presentations:{presentationId,itemId,shown,optionOrder,answered}[], attempts:{presentationId,itemId,optionId}[],
  current, assessments?:{presentationId, assistedWhenShown:false, assistedWhenAnswered}[]}`. It mirrors
  the pilot doc. Unknown, foreign, newer, future-day or incoherent docs block without being rewritten. If a doc
  this controller has already seen goes missing, it blocks with `owner` (reset safety, same as `bound`).
- Gate on every operation, before and after each await: disposed, `active()` (route focus), `mode ===
  'developer-demo'`, `readOnly() === false`, `consented()` (a learner exists in this dataset),
  `validateNominalDefiniteness(NOMINAL_DEFINITENESS)` returns `[]`, owner is text, then `unitAStatus` qualified.
- Transfer opens when `today > last teaching/practice day` and `!assistedToday(today)`. It records
  `assistedWhenShown`/`assistedWhenAnswered` exactly as `presentHeld`/`answer` do. `valid` counts are derived
  from that recorded context and never stored as a verdict.
- Views: `blocked{reason}`, `screen`, `question`, `feedback`, `assessment-feedback{deferred:true}`,
  `awaiting-transfer{until}`, `closed{counts}`. Route Back pauses and leaves the route. It does not advance,
  answer or call `next()`. Re-entry resumes the durable `current` question or feedback. Only an explicit continue
  action calls `next()`. An unanswered question cannot be skipped.

## Assistance provenance (no holes)
- `app/src/pilot/nextLesson/assistance.ts`: `nextLessonAssistedOn(store, day)` reads the next-lesson doc and
  returns true if any screen was shown or completed on `day`, or any practice presentation was shown or
  answered on `day`. An absent doc → false. An unreadable doc → reject (refuses the step, never "unassisted").
- `pilotAssistedOn` (in `UnitAPilotScreen.tsx`) also ORs in `nextLessonAssistedOn`. That means Unit A d7/d30 and
  next-lesson transfer both see new-lesson teaching and practice.
- Next-lesson transfer `assistedToday(day)` = `pilotAssistedOn(store, day)` OR `unitAStatus(...).days` includes
  `day`. Any Unit A activity on that day counts as assisted.
- Same day: once the Unit A transfer block closes, its recorded reads are final, so later teaching that day
  does not rewrite the past. Any next-lesson teaching on anchor+7 holds back d7 through the OR above.

## Exposure boundary
- Only `nextLesson/controller.ts` imports the increment's `content.ts` in production runtime code. New tests may
  import it explicitly and narrowly as fixtures; those are declared test exceptions, not production importers. `NextLessonScreen.tsx` uses controller
  view types only. Tester/production: the screen renders Unavailable, the controller blocks with `mode`, and
  the entry button only renders in developer-demo. The header caption keeps the "Draf belum ditinjau" label.
- The obsolete "namespace unimported" assertion is replaced narrowly, in a later TDD batch, by an explicit
  allow-list of production importers plus a negative proof. The proof scans production paths and checks the
  declared test exceptions, without spelling tricks. The other 16 curriculum tests and the guard regressions
  stay unchanged. Stale comments saying "not wired/unrouted" in `schema.ts`/`prerequisites.ts`/`content.ts`
  headers are updated, and nothing else in those files changes.
