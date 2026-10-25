# U-C nominal definiteness (reviewer note)

Constructed, synthetic draft. Not shipped, not routed, not imported by app code, and no
learner progress or unlock. Arabic, Indonesian and assessment review are all **pending**.

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
  practice/transfer item IDs (the ones `canAdvanceUnitA` reads). It is descriptive only.
- The validators are structural/contract checks. They are not a linguistic sign-off.

Points for human review:
- Indonesian naturalness of "lama" for objects (pena/buku) versus "tua".
- Whether the 'Sebuah …' choices are good distractors for definiteness.
- The scope caveat on the last lesson screen (this pattern only, not all adjectives or predicates).
