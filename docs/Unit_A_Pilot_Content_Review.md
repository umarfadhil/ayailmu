# Unit A Pilot Content — Review Handoff

> **Internal developer/reviewer document. Never render, bundle or link it in any learner-facing UI.**
> It lists answer keys and distractor intent for the held-out transfer, d7 and d30 banks.

Source reviewed: `app/src/pilot/unitA/content.ts` (only this file).

## Provenance and status (as recorded in the code)

- `contentVersion`: `unit-a-pilot-draft-0.1`
- `policyVersion`: `unit-a-evidence-provisional-0.1`
- `synthetic: true`, `constructed: true`, `reviewStatus: 'draft'` at bank level and on every item.
- All sentences are constructed teaching examples. Nothing in the bank is Quranic, and no item
  should be attributed to the Quran, hadith or any other source text.
- No human review has happened. No efficacy, learning-gain or retention claim is made or supported.
- Shape: 2 lessons (reference, agreement); 20 items = 2 constructs × (4 practice + 2 transfer + 2 d7 + 2 d30).
  Every item has exactly four options and one key. `validatePilotContent` checks shape, provenance and
  reserved-solution separation (see issue 9). It does not check linguistic correctness.

## Sign-off (all PENDING)

| Review | Status |
|---|---|
| Qualified Arabic reviewer (harakat, grammar, naturalness) | **PENDING** |
| Qualified Indonesian reviewer (prompts, glosses, feedback) | **PENDING** |
| Assessment/pedagogy reviewer (keys, distractors, family independence) | **PENDING** |

This document is an AI-drafted review aid. It is **not** an approval and must not be read as one.

## Item map (keys and distractor intent; full text deliberately not copied)

Ref = reference (pronoun → who); Agr = adjective agreement. Codes: gender = wrong-gender pronoun,
person = wrong person (1st/2nd/3rd), lexeme = right form but wrong meaning, swap = referent/clause
mix-up, base = base form where ـَةٌ is needed, over-ة = ـَةٌ on a masculine noun, num = dual/plural form.

| ID | Construct | Phase | Key | Distractor intent |
|---|---|---|---|---|
| ua-d01-ref-p01 | Ref | practice | b | a gender · c person · d lexeme |
| ua-d01-ref-p02 | Ref | practice | c | a gender · b person · d lexeme |
| ua-d01-ref-p03 | Ref | practice | d | a swap · b person · c gender |
| ua-d01-ref-p04 | Ref | practice | a | b gender · c person · d lexeme |
| ua-d01-agr-p01 | Agr | practice | c | a base · b lexeme (antonym) · d num (dual) |
| ua-d01-agr-p02 | Agr | practice | a | b over-ة · c lexeme · d num (dual) |
| ua-d01-agr-p03 | Agr | practice | d | a masculine noun · b base · c num (plural) |
| ua-d01-agr-p04 | Agr | practice | b | a endings swapped · c second ـَةٌ missing · d meanings swapped |
| ua-d01-ref-t01 | Ref | transfer | b | a gender · c swap · d absent person |
| ua-d01-ref-t02 | Ref | transfer | d | a speaker-gender confusion · b person · c lexeme |
| ua-d01-agr-t01 | Agr | transfer | c | a base · b masculine pronoun+adj · d lexeme |
| ua-d01-agr-t02 | Agr | transfer | a | b base (أنا has no gender) · c person · d lexeme |
| ua-d01-ref-d7-01 | Ref | d7 | c | a swap · b swap · d absent person |
| ua-d01-ref-d7-02 | Ref | d7 | a | b gender · c person · d lexeme |
| ua-d01-agr-d7-01 | Agr | d7 | d | a base · b lexeme · c num (plural) |
| ua-d01-agr-d7-02 | Agr | d7 | a | b over-ة · c lexeme · d num (dual) |
| ua-d01-ref-d30-01 | Ref | d30 | d | a gender · b swap · c swap |
| ua-d01-ref-d30-02 | Ref | d30 | b | a person · c gender · d lexeme |
| ua-d01-agr-d30-01 | Agr | d30 | b | a endings swapped · c over-ة · d lexeme |
| ua-d01-agr-d30-02 | Agr | d30 | c | a base · b masculine noun · d lexeme |

Each key letter (a–d) is used five times. Positions are fixed in data. Whether they get shuffled at
render time can't be seen from this file.

## Substantive issues observed (not certified; for the qualified reviewers)

Status labels: **Repaired in draft, pending human verification** means the text or validator was
changed by an AI-drafted repair. No qualified reviewer has confirmed the fix. **Open** means unchanged.

1. **Gender-by-ـَة heuristic overstated. Repaired in draft, pending human verification.** The agr-p02
   feedback and the agr-d7-02 prompt used to treat a missing ـَة as the *reason* a noun is masculine. That
   rule fails for nouns like شَمْس, أَرْض, أُمّ. Changes made:
   - The agreement lesson now says the adjective follows the given gender of the noun or person.
   - It says ـَة often marks a feminine noun but is not a fixed rule, and that a missing ـَة does not
     prove a noun is masculine.
   - The agr-p02 prompt now says only "maskulin". Its option-b feedback now gives that stated gender as
     the reason.
   - The agr-d7-02 prompt now says only "maskulin".
   - The noun example now calls ـَة a marker ("ditandai"), not proof.
   - The reference lesson's "no adalah" line is now limited to simple present nominal sentences.
   - No feminine-without-ـَة examples were added, to avoid new vocabulary or Unit B grammar.

   The agr-p01 and agr-d7-01 prompts still say "feminin (berakhiran ـَة)". In these, the ending
   describes the noun; it is not offered as proof of gender.
2. **Cross-construct cue in reference items. Open.** Several reference stems pair the pronoun with a gendered
   predicate (أنتِ مهندسة, أنتِ محامية, هي خياطة / أنت فلاح, أنتِ بائعة, هي ممرضة). A learner can choose
   the gender from the predicate's ـَة instead of the pronoun's harakat. So reference scores partly
   measure agreement.
3. **Agreement prompts state the noun's or referent's gender. Intentional, caveat stands.** Every agreement
   prompt gives the gender or the referent, and most also say "dengan akhiran sifat yang cocok". This is
   a deliberate scaffold: the items test *applying* agreement, not detecting gender. That does not make
   the assessment invalid. It does narrow what a correct answer shows (application only), and it adds to
   the near-transfer, family and MCQ-cue caveats below. This also holds at transfer/d7/d30.
4. **Gloss-elimination cue. Repaired in draft, pending human verification.** Each of the six reviewed
   opposite-meaning distractors now has a fully vowelled gloss for its base word, in the same
   "(bentuk dasar)" style as the item's other glosses:
   - agr-p01: صَغِيرٌ (kecil)
   - agr-p02: قَدِيمٌ (lama)
   - agr-d7-01: ضَيِّقٌ (sempit)
   - agr-d7-02: حَزِينٌ (sedih)
   - agr-d30-01: قَصِيرٌ (pendek)
   - agr-d30-02: غَاضِبٌ (marah)

   Only base words are glossed. No full option or answer sentence is translated, and the bank was not
   expanded. The Indonesian reviewer should check "lama" vs "tua" for قَدِيمٌ, and "pendek" as the
   opposite of the "tinggi" gloss for طَوِيلٌ.
5. **Dual/plural endings in distractors. Open (caveat clarified).** The lesson body never teaches the
   endings ـَانِ, ـَتَانِ and ـَاتٌ. Practice feedback does explain them: agr-p01 option d (ـَتَانِ),
   agr-p02 option d (ـَانِ) and agr-p03 option c (ـَاتٌ). So a learner first meets each ending as a
   *wrong* practice option and learns its meaning only from that option's feedback, and only if they open
   it. agr-d7-01 (option c, ـَاتٌ) and agr-d7-02 (option d, ـَانِ) reuse these endings as distractors. For a
   learner who never saw that feedback, those options may be either trivially rejected or confusing.
   Decide whether they stay, or whether one short lesson line is wanted. That line would introduce new
   morphology, so it was not added here.
6. **Lesson coverage gap. Repaired in draft, pending human verification.** agr-t01 and agr-t02 need the
   adjective to agree with a pronoun's referent. The agreement lesson now teaches this before transfer:
   - A body line maps هُوَ/أَنْتَ to the base form and هِيَ/أَنْتِ to ـَةٌ.
   - A body line says أَنَا has no masculine or feminine form, so the adjective follows the real speaker
     and the context matters.
   - A worked pronoun example, with an explicit "the speaker is a woman" context, contrasts the female
     form with the male form.

   The example uses only vocabulary already taught: أَنَا is from the reference lesson, and مُجْتَهِدٌ is
   from agr-p03. It uses no held-out root or reserved solution. The noun example (الْحَدِيقَةُ جَمِيلَةٌ)
   is kept. Caveat: the worked example has the same shape as agr-t02's sentence, so agr-t02 is now
   explicit near-transfer (different adjective, same pattern). The Arabic and Indonesian wording of the
   new lines is unreviewed.
7. **Harakat dependence. Open.** Telling أنتَ from أنتِ depends entirely on the final vowel mark. This is valid
   for vocalised pilot text but won't carry over to unvocalised reading. The UI must render harakat reliably.
8. **Gloss consistency (minor). Open.** Feminine job nouns are glossed without gender ("perawat", "insinyur"),
   but t02 and d30-02 mark "(laki-laki)/(perempuan)". مُرْتَاحٌ = "segar, cukup istirahat" may read
   better as "lega/santai". Defer to the Indonesian reviewer.
9. **Stem-separation check was shallow. Validator improved, pending human verification.** The check used
   to compare only the `arabic` field. For agreement items and ref-t02/d30-02, that field is a single word.
   For each transfer/d7/d30 item, the check now reserves two things: the normalized `arabic` stem, and
   the full text of the correct option (Arabic or Indonesian), counted once per item. Comparison is
   NFC-normalized and ignores harakat, punctuation, spacing and letter case. A reserved solution is
   reported if it:
   - appears inside any lesson string,
   - appears inside any string of an earlier-phase item, or
   - equals another assessment item's reserved stem or solution.

   The validator returns error strings. It does not throw on malformed input or modify it. Limits: it
   matches exact normalized substrings, so it misses paraphrases, partial leaks and same-template
   near-copies (see the family caveat). It is a leak guard, not a linguistic or pedagogical
   certification.

## Assessment caveats

- **Four choices on purpose.** Four options with one key keeps the format uniform across phases. The
  chance rate is 25%, and that baseline must be accounted for in any evidence rule.
- **Recognizable MCQ cues and guessing.** Distractors follow fixed templates: lexeme, base, num and
  swap on every item. Combined with issues 2–5, partial knowledge or test-wiseness can raise scores.
  A single correct answer is weak evidence.
- **Family independence is provisional.** Family IDs are distinct, but many held-out items reuse
  practice templates: agr-d7-01 ≈ agr-p01, agr-d7-02 ≈ agr-p02, agr-d30-01 ≈ agr-p04 (order swapped),
  agr-d30-02 ≈ agr-p03, agr-t02 ≈ the new pronoun worked example, and the ref two-clause "Pernyataan
  mana yang benar" in t01/d7-01/d30-01. Treat
  "transfer" as near-transfer until reviewed.
- **Transfer and retention are unmeasured.** Real transfer, d7 and d30 retention can only be judged
  from learner response data collected at the right delays. Nothing in this bank shows them.

## Data handling

- The reserved transfer/d7/d30 items will later be shown to learners as assessment questions, but only
  when each one is due. Until then, nothing reserved should appear early. That includes stems, options,
  keys, feedback and glosses, and it applies to lessons, practice, previews, logs and exports. Even when
  an item is due, show only that item. This doc, the reviewer key table and the distractor intent must
  never appear in any learner UI, log or export that learners can see.
- Pilot progress stays **local-only on the device** unless a separate, reviewed integration is added.
  `content.ts` has no storage, network or account code.
- **XP is deferred.** Pilot items award no XP and do not feed existing progress or streak systems.
