# U-C nominal definiteness (reviewer note)

Constructed, synthetic draft with no Qur'an attribution. Not shipped or published. Arabic,
Indonesian and assessment review are all **pending**.

Local developer-demo integration (see `docs/Next_Lesson_Nominal_Definiteness_Runtime.md`):
- The `/next-lesson` route runs this draft through `src/pilot/nextLesson/controller.ts`. Unit A
  offers it from qualified progress, and the controller checks the canonical Unit A
  qualification (`unitAStatus`) again on every operation. Otherwise it is blocked.
- The learner sees 4 teaching screens, then 6 practice tasks with feedback, then 4 transfer tasks.
  Transfer opens only on a later day with no recorded help. It shows no help lines, keys or
  feedback, and closes with descriptive counts only.
- Progress is kept in a separate metadata document (`pilot_next_nominal_definiteness`); Unit A
  records are only read. Teaching and practice displays, including a pause on Back or blur,
  are recorded as help days, which Unit A also counts as same-day assistance.
- It is unavailable in tester mode and in read-only tabs. It grants no mastery and no new unlock.

- `content.ts`: one Indonesian lesson contrasting الْـN الْـA (phrase, e.g. "rumah besar itu")
  with الْـN A (complete nominal sentence, e.g. "rumah itu besar"). There are 4 worked examples,
  including a minimal pair, then 6 practice tasks and 4 transfer tasks. Every task has four
  choices and one correct answer. Tasks run both ways: Arabic to meaning, and meaning to Arabic.
  Vocabulary is limited to 3 masculine singular nouns (gender supplied) and 4 regular
  adjectives. The lesson also teaches dropping tanwin under الـ and the sun-letter reading of الصَّغِيرُ.
- Transfer tasks use noun–adjective combinations that the lesson, practice, shipped packs and
  pilot never show. Each word in them is shown earlier. See `content.ts` for the tasks
  themselves; this note does not repeat them.
- `prerequisites.ts`: names the pilot `reference` and `agreement` lessons and their existing
  practice/transfer item IDs (the ones `canAdvanceUnitA` reads). It is descriptive only; the
  runtime does not read it.
- The validators are structural/contract checks. They are not a linguistic sign-off.

Points for human review:
- Indonesian naturalness of "lama" for objects (pena/buku) versus "tua".
- Whether the 'Sebuah …' choices are good distractors for definiteness.
- The scope caveat on the last lesson screen (this pattern only, not all adjectives or predicates).
