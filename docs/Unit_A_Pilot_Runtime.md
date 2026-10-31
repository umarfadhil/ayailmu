# Unit A Pilot — Runtime Guide

Developer guide to the Unit A pilot loop (`/unit-a-pilot`). It is separate from the
legacy four-choice engine described in `app/README.md`. Content review:
[`Unit_A_Pilot_Content_Review.md`](Unit_A_Pilot_Content_Review.md).

> **Status:** usable developer beta. This is **not** an approved public curriculum.
> D7/D30 delayed checks are implemented in the developer beta. All human content reviews
> remain **PENDING**.

## Reaching it

- Developer mode: Home card «Belajar dengan contoh» / «Buka latihan baru» → `/unit-a-pilot`.
- The adult consent/profile flow is retained before the loop.
- Tester/production configuration hides the unreviewed pilot. No sign-in or security
  gate was changed.

## Learning loop

- 2 worked lessons: reference (pronoun) and agreement.
- 8 practice items, four choices each, with immediate feedback.
- 4 held-out transfer items, on a later unassisted day. Grading is deferred until the
  block closes.
- A selection can change until the learner explicitly presses «Periksa»/«Simpan». Only
  then is the first choice saved, before feedback is shown, and it is immutable. A
  reopened item stays the same.
- The finite bank is 20 items, used once. There are no new remedial families and no
  automatic retakes.

## Provisional evidence rules

- Provisional status uses the evaluator's `canAdvanceUnitA`: correct answers across
  distinct practice families, then fresh transfer, for each construct. Attempts and XP
  do not count.
- No Unit B mastery or unlock claim is made.
- The first qualifying CLOSED transfer day anchors D7 (+7) and D30 (+30), with 4 items
  each. The original anchor is unchanged if D7 is taken late.
- D7 comes before D30. The two cannot both be distinct blocks on the same primed day.
- Assistance, or a question first shown on one day and answered on another, keeps the
  same choice but does not count as an independent context. Invalidity is per question,
  not for a whole block that spans days.
- Answered, correct and valid counts are descriptive. They are not retention proof.

## Content status

Content is constructed, synthetic and draft, with no Quran attribution. All three human
reviews (Arabic, Indonesian, assessment) are **PENDING**; see the review handoff above.

## Storage and privacy

- Uses the selected store: SQLite on native, `localStorage` on web.
- Metadata is keyed `pilot_unit_a`, with owner and versions. Guest and account data are
  isolated.
- The new pilot metadata is **local only**. It is not cloud-synced and is not in any
  server or account-export payload.
- Whole own-dataset deletion includes this metadata. It has not been validated against a
  real service here.

## Verification

- Browser fixtures with simulated dates prove engineering behaviour only. They are not
  evidence of 7/30-day human retention. Do not ask users to change the Mac clock.
- Regression tests cover the delayed-transfer controller. Normal browser runs covered
  practice, transfer, D7/D30 and restart with scripted dates.
- A release needs the current tests, type check, lint and current CI to pass. No pass
  counts are recorded here; do not trust a number in a document.
- Local build and CI preparation is local proof only. It does not show CI is green.
  Publication, signing and deploy each need separate approval.

## Not built / still future

- No XP is implemented this milestone. A later decision may let meaningful learning
  actions earn XP, but XP must never replace mastery evidence or unlock content by itself.
- Placement, a prerequisite graph, adaptive remediation and the full curriculum.
- Store signing, physical-device checks, live backend and human-review gates remain.
  JavaScript exports are not native binaries.
- No claim is made of native builds, human approval or learning efficacy.
