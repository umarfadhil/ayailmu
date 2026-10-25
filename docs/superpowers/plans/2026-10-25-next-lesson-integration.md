# Plan: next lesson integration (nominal definiteness)

Spec: `docs/superpowers/specs/2026-10-25-next-lesson-integration-design.md`. TDD: for each batch, write the new
tests first. The coordinator confirms a valid RED and freezes those tests before any production edit. The
coordinator runs Node 22.16 Jest/typecheck/lint after each batch. Root runs independent review and browser
checks. No package/EAS/Expo config, thresholds, content data/prose/IDs, backend/auth, or old-test edits beyond
B6. New test files go in the existing test directory convention next to the code they cover.

## B1: read-only qualification (smallest first RED)
Tests (`unitAStatus.test.ts`, alongside the existing Unit A controller tests):
1. `unitAStatus(null, owner, today)` → `{qualified:false, days:[]}`.
2. Drive the real `createPilotController` on an in-memory store until `progress.provisional === true`. Then
   `unitAStatus(raw)` gives `qualified === true`, using the same raw document. Also drive to a non-provisional
   closed transfer and check `qualified === false`. Parity check, only for stages up to and including the
   initial closed transfer: `qualified === (view is progress && provisional)`. After that, parity with the
   progress view no longer applies: qualification stays true (the anchor holds) while a real d7/d30 question
   is active and after a wrong delayed answer. The new test covers a real d7.
3. A foreign owner, a corrupt/version/schema doc, an invalid owner or calendar day, or a future day → `null`.
4. Spy store: no `setMeta`/`updateMeta` calls, and the stored bytes are unchanged. Reading the status never
   opens anything (d7 is not opened by the read).
Prod: export `unitAStatus` and `pilotQueueFor` from `app/src/pilot/unitA/controller.ts` (additive only).

## B2: next-lesson controller core
Tests (`app/src/pilot/nextLesson/controller.test.ts`):
- Unqualified → `blocked:not-qualified` on load/next/answer, with nothing written. Qualified → screen 1.
  Then: 4 screens in order, 6 practice items, each with 4 permuted options persisted before display, first
  choice saved before feedback, and a re-answer with a different option rejects.
- Every operation re-gates: flipping `active`, `readOnly`, `consented` or mode mid-operation (during an awaited
  `assistedToday`) → blocked, no write. Removing the pilot doc after entry → `not-qualified`.
- `listAnswers()` and screen views are unchanged. `PILOT_META_KEY` bytes are unchanged.
Prod: new `app/src/pilot/nextLesson/controller.ts`, mirroring `run`/`gate`/`parse`/`coherent` from the pilot.

## B3: transfer, deferred grading, counts
- Same day as the last practice → `awaiting-transfer{until: +1}`. An assisted later day → `until: today+1`.
- 4 transfer items: `assessment-feedback{deferred:true}` with no key or correctness until the 4th answer. Then
  `closed{answered, correct, valid}`, where `valid` comes from the shown/answered context.
- Pause/restart: a new controller resumes the same `current` presentation and option order.

## B4: assistance provenance
- `nextLessonAssistedOn` covers screen days and practice days. Transfer days are excluded. An unreadable doc
  rejects.
- `pilotAssistedOn` returns true on a next-lesson teaching day. A Unit A d7 due that day is held back
  (`availableOn` = next day). Next-lesson transfer is held back on a Unit A pilot activity day.
Prod: new `app/src/pilot/nextLesson/assistance.ts`; one OR line in `pilotAssistedOn`.

## B5: route, screen and entry
- `UnitAPilotScreen` gets an optional `onNextLesson` prop. The button (`pilot-next-lesson`) renders only on
  `progress` with `provisional` in developer-demo. It is absent for a non-provisional result and in tester mode.
- New `app/src/app/next-lesson.tsx` mirrors `unit-a-pilot.tsx`: `HydrationGate write`, a focus-visit remount,
  `Redirect` when there is no learner, and Back to `/unit-a-pilot`. A direct deep link while unqualified shows
  the blocked notice. The owner is `${dataset}:${learner_id}`, and switching accounts remounts the panel
  (store/owner key).
- New `app/src/pilot/nextLesson/NextLessonScreen.tsx`: tester mode → Unavailable, and no store call happens.
  Heading focus moves on each new view.
- `app/src/app/unit-a-pilot.tsx`: pass `onNextLesson={() => router.push('/next-lesson')}`.

## B6: import boundary (supersedes one obsolete assertion)
- Replace only the frozen curriculum assertion that says the increment namespace is unimported, by locating
  its exact text. Check it against the archived hashes in the coordinator folder. The replacement allow-list
  says that only `app/src/pilot/nextLesson/controller.ts` imports
  `content/increments/nominal-definiteness/content` in production runtime code. Explicit, narrow fixture imports
  in new tests are legitimate and are listed as declared test exceptions. Negative proof: a scan of production
  `src/**` paths finds no other importer, the declared test exceptions are checked as listed, and the increment
  does not import `nextLesson`. No spelling tricks. The other 16 tests and every guard regression stay
  byte-identical.
- Update the stale "not shipped/routed/wired" header comments only. `integration.shipped:false` and the review
  flags stay as data.

## Exit
- All new and old suites pass, along with typecheck and lint. `147ce7e` stays an ancestor. No push, merge or
  deploy.
