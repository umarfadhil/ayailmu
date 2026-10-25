# Next lesson (U-C nominal definiteness): runtime handoff

Local developer-demo integration of the constructed U-C nominal-definiteness draft. It is not
published and has no backend. It makes no claim about learning efficacy, and it is not a
linguistic or assessment certification. This note describes the code as it stands; it does not
redesign anything.

## Route and entry

- Route: `app/src/app/next-lesson.tsx` (`/next-lesson`) renders `NextLessonScreen` inside
  `HydrationGate write`. Without a learner or store it redirects to `/`. Back calls
  `router.dismissTo('/unit-a-pilot')`.
- Entry: on its durable `progress` view, `UnitAPilotScreen` offers "Pelajaran berikutnya"
  (`pilot-next-lesson`), but only when the view is `provisional === true` (qualified),
  the mode is `developer-demo` and the route passed `onNextLesson`. The button only pushes
  `/next-lesson`. A direct link opens the same screen, and the screen's guards apply as usual.
- The route mounts a fresh screen on each focus (`visit` key). While blurred it keeps nothing
  mounted.

## Qualification (canonical, read-only)

Inside every `load`/`next`/`answer`/`pause` update, the controller reads the Unit A document
(`PILOT_META_KEY`) afresh and calls `unitAStatus(raw, owner, today)`. Anything except
`qualified === true` blocks with `not-qualified` and writes nothing. Qualification is never
cached or stored here, and Unit A records are never written. `prerequisites.ts` is descriptive
and is not read at runtime.

## Live guards

`gate()` runs before the queued work starts, and `recheck()` runs again after the next-lesson
read, after the Unit A read, after the step (which may await the assistance read) and after the
write. It checks:

- not disposed
- same store/owner binding
- `active()`; skipped only by a pause that was authorized while active
- `consented()`: the route still has this learner on this store
- `mode === 'developer-demo'`
- not read-only
- the content plan is valid
- `updateMeta` is available
- `today()` is a real calendar day and has not changed during the operation

Work runs on the shared pilot queue (`pilotQueueFor(store)`). A blocked operation returns a
`blocked` view and does not rewrite anything. IO errors, assistance errors and write errors make
the operation reject, and nothing is published.

## Separate metadata

The controller keeps one versioned document per owner under `NEXT_LESSON_META_KEY =
'pilot_next_nominal_definiteness'`:

- `owner`, `schema`, `contentVersion`
- `screens` (shown days, completion day)
- `presentations` (shown day, persisted option order, answered day)
- `attempts`
- `current`
- `helpDays`
- `assessments`, which is absent until the first transfer task is shown

The parser is strict. It returns `corrupt`, `schema`, `owner`, `version` or `future-day` for an
unknown, foreign, future or incoherent document, and that document is left untouched. If this
controller has seen its document stored and it later disappears, it blocks.

## First choice, order, resume

- The order is 4 teaching screens, then 6 practice tasks in content order, then 4 transfer
  tasks in content order (`buildPlan` requires exactly these counts and the draft's own
  validator to return no problems).
- Each display is written before it is shown. Option order is shuffled once and persisted, so a
  reload or reopened store resumes the same question.
- The first choice (or "don't know", `null`) is saved with its day before feedback. Replaying the
  same choice shows its feedback again. A different choice blocks with `answered` and never
  replaces the first. A stale presentation id blocks with `stale`. Only `next` moves on, and an
  unanswered question cannot be skipped.

## Help days, assistance bridge, pause vs load

- `helpDays` records every day on which teaching, a practice question or practice feedback was
  displayed. Transfer is never recorded there.
- Transfer opens only from the day after the last help day (`awaiting-transfer` with `until`
  until then). Each new transfer task also needs the assistance read to be false that day. That
  read is the injected `assistedToday(day)` (the screen passes `pilotAssistedOn(store, day,
  owner)`) OR'd with the learner's own Unit A activity days from `unitAStatus`. A non-boolean,
  a throw or a rejection rejects the operation without writing.
- Bridge back to Unit A: `pilotAssistedOn` also calls `nextLessonAssistedOn`
  (`assistance.ts`), which reads this document through the controller's own parser
  (`nextLessonHelpDays`). No document means no help. An unreadable or foreign document rejects.
  The bridge never writes or repairs anything.
- `pause()` (Back, blur, unmount, going to the background, the new-day poll) differs from
  `load`. It never settles, advances, answers or presents anything. It only records today as a
  help day (and a screen exposure) for the teaching screen, practice question or practice
  feedback that the last returned view showed and that the stored document still has on
  display. It is authorized synchronously with every guard, including `active`. Only that
  queued pause may finish after the route blurs, and only on the same day.
- Screen lifecycle: the binding updates in the layout phase, so an old panel's pause sees a
  changed account, mode or store and records nothing.
  - Cleanup and going to the background flush only a view that is still visible, then hide it.
  - The panel disposes the controller only after pending pauses settle.
  - Late results from a superseded epoch are dropped.
  - The 30 s day poll flushes and reloads only teaching or practice. On an awaiting or blocked
    view it only updates the day, so it never presents a reserved task.
  - If a Back pause fails, the learner stays on the screen and gets a retry.

## Frozen pending-review data

`content.ts` is frozen. It is still `review_status: 'draft'`, `synthetic: true`,
`constructed: true` and `quran_attribution: false`, with Arabic, Indonesian and assessment
review all `pending`. `integration` is still `{ shipped: false, automatic_unlock: false }`.
The screen labels it "Draf belum ditinjau".

## Descriptive results

Transfer questions show no help lines, keys or feedback. Each saved choice is acknowledged as
`assessment-feedback` (deferred). The assistance read at answer time is stored beside each
choice. Late or assisted answers are kept. The fourth answer closes the block with `closed`
counts:

- `answered`
- `correct`: matches the draft key
- `valid`: shown and answered on the same day, unassisted both times

These counts are not a pass, mastery, retention or unlock. The block is not retaken in this
version.

## Modes and limitations

- It works only in `developer-demo`. Tester mode and read-only tabs show an unavailable notice,
  and the controller also blocks those cases (`mode`, `read-only`).
- Storage is local only, on the selected store. There is no sync, backend or publication.
- It grants no mastery and no new unlocks. Nothing feeds `canAdvanceUnitA`.
- The content is a single lesson. The review points listed in the increment README are still
  open.

## Tests

- `app/src/content/increments/nominal-definiteness/__tests__/content.test.ts`: content contract,
  validators and the import boundary. The boundary scans imports with the TypeScript parser and
  allows only the listed next-lesson importers.
- `app/src/pilot/nextLesson/__tests__/`: `controller.core`, `controller.practice`,
  `controller.transfer`, `controller.transferGates`, `controller.gates`, `controller.pause`,
  `assistance` and `NextLessonScreen`, using fixtures in `__fixtures__/helpers.ts`.

This document does not record any test results. Validation runs are recorded separately by the
coordinator.
