# Four-choice local learning loop

Status: implementation contract for the user-authorized local slice, 2026-10-15. No remote publication or distribution is authorized by this continuation.

## Purpose and authority

Extend the existing Arabic trial prototype into a usable local practice/review loop for Indonesian-speaking adults. Preserve the Sottaku-inspired visual system and native Arabic typography. The user's latest instruction supersedes the draft documents' typed/binary exercise UI: every graded learner question has exactly four answer choices, one unambiguously correct and three defensible distractors. Configuration controls and consent checkboxes are not graded exercises.

Source requirements: `../../Trial_App_Spec.md` sections5–10, `../../Arabic_Course_Current_Plan.md` sections4–7, and `../../Lessons_Unit_A_B_Draft.md` Unit A/Unit B. Those source snapshots stay unchanged. All newly authored content remains synthetic, draft and inaccessible in tester mode.

## Canonical workspace and execution

Work in this repository's `app/` on local `feature/four-choice-learning-loop`, based on `f6d76e9`. The historical workspace is preserved. The existing Claude Code session remains the single implementation writer, with Opus5.5 High and ordinary Auto safeguards. Codex supervises review/QA and commits after verification. No push, backend, authentication, new paid service or deployment. No new product dependencies are needed.

## Four-choice contract

- One current question UI: four answer tiles, immediately scored after a tap, as existing choice questions are. No mandatory answer input or binary exercise sub-panel.
- Keep quiet don't-know and report controls outside the answer set; they are auxiliary actions, not a fifth alternative.
- Word meanings use distinct, non-overlapping Indonesian senses from taught vocabulary. Sentence interpretations distinguish gender, lexical meaning, possession and invented-action errors.
- Form questions may select a complete Arabic sentence, crossing the taught pronoun and gender ending. Do not introduce plurals, first/second person, unsupported case rules or invented Arabic forms to fill slots.
- Unit B taught-verb interpretations may cross gender with two taught actions. Do not use potentially equivalent noun phrases such as “orang yang keluar” as an allegedly unambiguous wrong translation of an event. A compound distractor must name each misconception; no absurd filler.
- Each option has a stable ID; each wrong option records its specific misconception(s), seriousness and feedback. Record the rationale in the content review audit. The answer key must be independently checked against source meanings, not only count one `correct` flag.
- Validate four unique option IDs/texts and exactly one key, required misconception/feedback metadata, harakat and pool/form constraints. Ambiguous senses still require human content review; a validator cannot certify pedagogy.
- Shuffle once when a step is queued or inserted, using an injectable RNG. Persist the permutation in the snapshot. Reload, retry and resize reuse it. A newly presented attempt can get a different permutation. Log the shown order, selected ID/position and assessment version; never expose correctness through accessible labels before grading.
- Four-choice recognition is never typed or constructed evidence. Legacy typed grading stays available only for versioned history/analysis, not as a learner question path.

## Content boundary and prerequisites

Convert active Unit A practice, focus, remediation, readiness and timed-check items to versioned four-choice equivalents with explicit legacy lineage. Preserve the three unchanged Unit A lesson IDs and previously seen screens.

Add Unit B's five documented taught verbs, their existing introductory explanations and bare-verb practice/readiness/review/check equivalents that support defensible choices. For this slice:

- Basic Unit B follows completion of Unit A core lesson screens and attempted core PRACT items. This is practice progression, not a claim that Unit A is learned. Keep it configurable and clearly distinguish it from mastery.
- VRB-02 remains locked by VRB-01 learned; speech remains locked by NOM-01 learned. Do not show advanced worked examples early through guides either. Their full implementation can remain deferred while the mastery decision is open.
- Exclude glossed bare-verb items that cannot support three strong distractors. Do not pad them. Report the resulting sparse check coverage.
- Mini readings and entry/audio diagnostics remain outside this slice; their original binary/three-answer questions must not be exposed through a fallback route.
- Protect the VRB-01 reserved forms even in taught-verb word cards and the word list. For example, do not show رَجَعَ before its D7 check or سَمِعَتْ before D30; سَمِعَ is a READY form, so no early lexical card may reveal it before its prerequisite. Only display introduced safe forms; a vocabulary table is not permission to violate the more specific check reservation.
- Do not resolve the documented MT-B2/VT1 and MT-B3/VT2 transfer clashes silently or count those forms as unseen transfer.

## Progress and unresolved product rule

The source “learned” rule requires two typed/built answers; word learned requires typed meaning on two days. That conflicts with the new four-choice-only interaction. A clarification is pending. Until a replacement rule is explicitly agreed:

- Show factual introduced/practised states, attempts, correct choice counts, days practised, review dates/levels and unresolved serious errors, with provenance and config version.
- Keep learned and word-learned unassessed. Do not lower thresholds or reinterpret choices as production.
- Keep the three unit lines for learned,7/30-day retention and transfer separate. Raw check counts can be shown, but do not invent remembered/transfer cutoffs or turn insufficient item coverage into a pass/fail claim.
- Pending legacy answers count neither correct nor wrong. Never recompute their raw answer using a new option key. Show legacy and recognition evidence separately where relevant.
- No combined percentage, badges, ranks, false completion claim or learning-efficacy claim. A word list must not reveal unintroduced/reserved Arabic forms or their meanings.
- Summary/home next-due dates come from actual review/check projections, not a hard-coded tomorrow date. With nothing due, do not save a fake empty completed session over the last real summary.

## Durable reviews and session planning

Use the immutable answer log and versioned config as the durable source of truth. Deterministic replay rebuilds review/progress projections after restart; avoid independently mutable counters that can drift from the log.

- Initial eligible word/sentence exposure schedules +1 calendar day. Correct review advances on the documented1,3,7-day ladder; wrong/don't-know review steps back one level, with minimum1 day. Label these as provisional pilot settings.
- A review key identifies the same word/sentence lineage across the old and new content versions. Old seen material must not become fresh merely because IDs changed.
- Overdue keys appear once, not once per missed day; deterministic oldest-due ordering. No review on the same day as the latest relevant exposure.
- Reviews have explicit `REVIEW` role/pool, never fresh evidence, and cannot become first attempts. Check items are never recycled as reviews.
- Plan due D7/D30 checks first, due reviews second, then the current lesson/readiness work. Review slots are capped by `floor(session_minutes * review_share_max)` with `review_share_max=0.5`. Check the actual review-time allowance at item boundaries too; do not interrupt an item halfway through. Document the one-item boundary limitation.
- Reviews and D7/D30 events must not move the unit's fresh-practice anchor and postpone later checks forever. Use the recorded role, not just a reused source item pool.
- Keep existing READY attempt prerequisites, later-day rules and reserved-form protections. Account for Arabic forms shown in options/lesson examples too; never expose a reserved check form as an early distractor.
- Serious errors in any role still need a correct focused question plus a fresh correct REMED answer. Do not count a repeated focused question as fresh.
- Where eligible check content is sparse, show incomplete coverage and retain the due/partial status. Do not fabricate additional questions or pretend a one-item sample meets the source's2–3-item budget.

## Safe data evolution

Keep answer IDs, raw response strings, timestamps, legacy scores, consent, learner ID, settings and reports unchanged. New answer/schema/evidence fields are optional when reading old records.

Keep a read-only legacy content registry for lineage and historical interpretation. Use a new active content version and new item IDs with lineage mappings. A legacy in-progress snapshot cannot resume into mandatory typing: archive the complete original snapshot atomically and start the new format using the preserved history/seen screens. Show a short, honest migration notice; do not silently reset progress. Failed migration/archive writes must leave the previous saved state intact. New sessions must persist before display.

Both SQLite and web stores need metadata read/write and an atomic archive-current-snapshot operation. Validate storage/snapshot versions; refuse unsupported future or unreadable outer data without overwriting it. An invalid current permutation is set aside with an explanation rather than graded using a different order. Duplicate answer IDs must not double-advance review state or rewind a newer snapshot.

## Verification and acceptance

Regression tests precede implementation. Required contracts: four-option validity/key correctness; meaningful distractors; order stability across retry/reload/resize and new-attempt shuffling; all new scoring paths; review ladders/day boundaries/caps/order/anchors; serious remediation; lineage freshness; safe v1 migration and unsupported-future refusal in both stores; factual progress and locked advanced paths; consent, draft gates and transaction rollback.

Full Jest suite, typecheck, lint, clean web exports and independent rendered QA must pass. Test fresh profiles and realistic legacy saves. Browser QA covers Unit A→basic Unit B, next-day review, timed-check partial status, migration, four-choice feedback, double taps, failed-save retry, menu/guide/progress/settings/reporting, mobile/desktop and tester mode with legacy developer data. Keep screenshots/scripts/logs outside committed source. No native-device claim without actual device validation.

## Rulings carried into the slice

1. Factual progress with learned unassessed is the conservative state while the product clarification is pending; changing mastery thresholds is deferred.
2. Basic Unit B begins after Unit A core practice, because the source only imposes learned prerequisites on its advanced branches. If this interpretation is changed later, the config/progression rule can be revised without rewriting history.
3. Exclude weak four-option items and unbuilt diagnostics/mini readings; the cost is deliberately narrower content/check coverage, reported explicitly.
4. Reviews are durable by deterministic event replay; the cost is recomputation over the small local trial log, rather than a second mutable schedule store.
5. Archive incompatible snapshots with a visible format-change notice; preserve every old answer and all learner data. The cost is a new session boundary at the format upgrade, not lost evidence.
