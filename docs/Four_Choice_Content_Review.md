# Four-choice content review (synthetic draft pack `demo-synthetic-0.2`)

**Status:** DRAFT. These items are synthetic. They are modelled on `Lessons_Unit_A_B_Draft.md` and have **not** been reviewed.
Nothing here is approved for trial; tester mode never shows it. The three source documents in `docs/` are unchanged.

**How the four answers are built** (per the four-choice design spec):
- Every graded question has exactly four options: one key and three distractors. Each distractor names its misconception(s), its seriousness and its feedback.
- Word meanings reuse the **source's own entry-check option sets**, E-L1…E-L8 (lessons §1.5).
- Sentence interpretations cross three things: gender (he/she), possession reading and invented action (lessons §2.6, §2.8).
- Form questions cross the taught pronoun with the gender ending, as complete Arabic sentences. There are no plurals, first- or second-person forms, or invented forms.
- Unit B verb readings cross doer gender with a second introduced action. A compound distractor names both misconceptions.
- A validator checks structure only: 4 options, 1 key, unique text, metadata and harakat. **Pedagogy and every key still need human review.**

## Items

| Item | Unit/pool | Format | Arabic / target | Key | Distractors (misconception · serious) |
|---|---|---|---|---|---|
| A2-M01 | A/PRACT | word-meaning | صَادِقٌ | orang yang jujur | orang yang bersedekah (look-alike · biasa)<br>sahabat (look-alike · biasa)<br>orang yang sakit (lexical · biasa) |
| A2-F01 | A/PRACT | form-grid | «Dia (perempuan) orang yang menyesal» | هِيَ نَادِمَةٌ | هِيَ نَادِمٌ (wrong-form · biasa)<br>هُوَ نَادِمٌ (wrong-referent · serius)<br>هُوَ نَادِمَةٌ (wrong-referent+wrong-form · serius) |
| A2-P01 | A/PRACT | interpretation | هِيَ مُؤْمِنَةٌ | Dia (perempuan) orang yang beriman | Dia (laki-laki) orang yang beriman (wrong-referent · serius)<br>Keimanannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya beriman (invented-action · serius) |
| A2-M02 | A/PRACT | word-meaning | عَالِمٌ | orang yang berilmu / mengetahui | orang yang taat beribadah (look-alike · biasa)<br>alam semesta (look-alike · biasa)<br>orang yang lalai (lexical · biasa) |
| A2-F02 | A/PRACT | form-grid | «Dia (laki-laki) orang yang gembira» | هُوَ فَرِحٌ | هُوَ فَرِحَةٌ (wrong-form · biasa)<br>هِيَ فَرِحَةٌ (wrong-referent · serius)<br>هِيَ فَرِحٌ (wrong-referent+wrong-form · serius) |
| A2-P02 | A/PRACT | interpretation | هُوَ صَالِحٌ | Dia (laki-laki) orang yang saleh | Dia (perempuan) orang yang saleh (wrong-referent · serius)<br>Kesalehannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya saleh (invented-action · serius) |
| A2-P03 | A/PRACT | interpretation | هِيَ شَاكِرَةٌ | Dia (perempuan) orang yang bersyukur | Dia (laki-laki) orang yang bersyukur (wrong-referent · serius)<br>Rasa syukurnya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya bersyukur (invented-action · serius) |
| A2-R01 | A/REMED | interpretation | هِيَ عَابِدَةٌ | Dia (perempuan) orang yang beribadah | Dia (laki-laki) orang yang beribadah (wrong-referent · serius)<br>Ibadahnya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya beribadah (invented-action · serius) |
| A2-R02 | A/REMED | interpretation | هُوَ كَاذِبٌ | Dia (laki-laki) orang yang berbohong | Dia (perempuan) orang yang berbohong (wrong-referent · serius)<br>Kebohongannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya berbohong (invented-action · serius) |
| A2-F03 | A/REMED | form-grid | «Dia (perempuan) orang yang takut» | هِيَ خَائِفَةٌ | هِيَ خَائِفٌ (wrong-form · biasa)<br>هُوَ خَائِفٌ (wrong-referent · serius)<br>هُوَ خَائِفَةٌ (wrong-referent+wrong-form · serius) |
| A2-Y01 | A/READY | interpretation | هِيَ صَالِحَةٌ | Dia (perempuan) orang yang saleh | Dia (laki-laki) orang yang saleh (wrong-referent · serius)<br>Kesalehannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya saleh (invented-action · serius) |
| A2-D7S1 | A/D7 | interpretation | هُوَ صَابِرٌ | Dia (laki-laki) orang yang sabar | Dia (perempuan) orang yang sabar (wrong-referent · serius)<br>Kesabarannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya sabar (invented-action · serius) |
| A2-D7S2 | A/D7 | interpretation | هِيَ عَالِمَةٌ | Dia (perempuan) orang yang berilmu | Dia (laki-laki) orang yang berilmu (wrong-referent · serius)<br>Ilmunya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya berilmu (invented-action · serius) |
| A2-D7S3 | A/D7 | interpretation | هِيَ غَافِلَةٌ | Dia (perempuan) orang yang lalai | Dia (laki-laki) orang yang lalai (wrong-referent · serius)<br>Kelalaiannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya lalai (invented-action · serius) |
| A2-D7F1 | A/D7 | form-grid | «Dia (perempuan) orang yang sedang tidur» | هِيَ نَائِمَةٌ | هِيَ نَائِمٌ (wrong-form · biasa)<br>هُوَ نَائِمٌ (wrong-referent · serius)<br>هُوَ نَائِمَةٌ (wrong-referent+wrong-form · serius) |
| A2-D7F2 | A/D7 | form-grid | «Dia (laki-laki) orang yang selamat» | هُوَ سَالِمٌ | هُوَ سَالِمَةٌ (wrong-form · biasa)<br>هِيَ سَالِمَةٌ (wrong-referent · serius)<br>هِيَ سَالِمٌ (wrong-referent+wrong-form · serius) |
| A2-D7W1 | A/D7 | word-meaning | مُؤْمِنٌ | orang yang beriman | orang yang merasa aman (look-alike · biasa)<br>orang yang meminta (lexical · biasa)<br>orang yang tidur (lexical · biasa) |
| A2-D7W3 | A/D7 | word-meaning | صَادِقَةٌ | orang yang jujur | orang yang bersedekah (look-alike · biasa)<br>sahabat (look-alike · biasa)<br>orang yang sakit (lexical · biasa) |
| A2-D7W5 | A/D7 | word-meaning | عَالِمَةٌ | orang yang berilmu / mengetahui | orang yang taat beribadah (look-alike · biasa)<br>alam semesta (look-alike · biasa)<br>orang yang lalai (lexical · biasa) |
| A2-D30S1 | A/D30 | interpretation | هُوَ عَالِمٌ | Dia (laki-laki) orang yang berilmu | Dia (perempuan) orang yang berilmu (wrong-referent · serius)<br>Ilmunya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya berilmu (invented-action · serius) |
| A2-D30S2 | A/D30 | interpretation | هِيَ كَرِيمَةٌ | Dia (perempuan) orang yang mulia | Dia (laki-laki) orang yang mulia (wrong-referent · serius)<br>Kemuliaannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya mulia (invented-action · serius) |
| A2-D30F1 | A/D30 | form-grid | «Dia (laki-laki) orang yang sedih» | هُوَ حَزِينٌ | هُوَ حَزِينَةٌ (wrong-form · biasa)<br>هِيَ حَزِينَةٌ (wrong-referent · serius)<br>هِيَ حَزِينٌ (wrong-referent+wrong-form · serius) |
| A2-D30F2 | A/D30 | form-grid | «Dia (perempuan) orang yang sedang duduk» | هِيَ جَالِسَةٌ | هِيَ جَالِسٌ (wrong-form · biasa)<br>هُوَ جَالِسٌ (wrong-referent · serius)<br>هُوَ جَالِسَةٌ (wrong-referent+wrong-form · serius) |
| A2-D30W2 | A/D30 | word-meaning | صَالِحَةٌ | orang yang saleh / baik | orang yang sedang salat (look-alike · biasa)<br>orang yang mencari (lexical · biasa)<br>orang yang malas (lexical · biasa) |
| A2-D30W4 | A/D30 | word-meaning | صَابِرَةٌ | orang yang sabar | orang yang marah (lexical · biasa)<br>orang yang berpuasa (lexical · biasa)<br>orang yang pergi (lexical · biasa) |
| A2-D30W6 | A/D30 | word-meaning | كَرِيمَةٌ | orang yang mulia | orang yang kaya (lexical · biasa)<br>orang yang kuat (lexical · biasa)<br>orang yang lemah (lexical · biasa) |
| A2-FQ-REF-F | A/FOCUS | interpretation | هِيَ صَادِقَةٌ | Dia (perempuan) orang yang jujur | Dia (laki-laki) orang yang jujur (wrong-referent · serius)<br>Kejujurannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya jujur (invented-action · serius) |
| A2-FQ-REF-M | A/FOCUS | interpretation | هُوَ صَادِقٌ | Dia (laki-laki) orang yang jujur | Dia (perempuan) orang yang jujur (wrong-referent · serius)<br>Kejujurannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya jujur (invented-action · serius) |
| A2-FQ-POS | A/FOCUS | interpretation | هُوَ صَادِقٌ | Dia (laki-laki) orang yang jujur | Dia (perempuan) orang yang jujur (wrong-referent · serius)<br>Kejujurannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya jujur (invented-action · serius) |
| A2-FQ-ACT | A/FOCUS | interpretation | هِيَ صَابِرَةٌ | Dia (perempuan) orang yang sabar | Dia (laki-laki) orang yang sabar (wrong-referent · serius)<br>Kesabarannya (sesuatu yang ia miliki) (possession · serius)<br>Dia berkata bahwa dirinya sabar (invented-action · serius) |
| B2-W1 | B/PRACT | word-meaning | ذَهَبَ | dia pergi | dia datang (lexical · biasa)<br>dia minum (lexical · biasa)<br>dia berdiri (lexical · biasa) |
| B2-W2 | B/PRACT | word-meaning | خَرَجَ | dia keluar | dia masuk (lexical · biasa)<br>dia menulis (lexical · biasa)<br>dia duduk (lexical · biasa) |
| B2-W3 | B/PRACT | word-meaning | دَخَلَتْ | dia masuk | dia keluar (lexical · biasa)<br>dia menulis (lexical · biasa)<br>dia duduk (lexical · biasa) |
| B2-VN1 | B/PRACT | verb-identify | Mana yang perbuatan? | صَبَرَتْ | صَابِرَةٌ (ta-confusion · biasa)<br>صَادِقَةٌ (ta-confusion · biasa)<br>مُؤْمِنَةٌ (ta-confusion · biasa) |
| B2-VN2 | B/PRACT | verb-identify | Mana yang perbuatan? | دَخَلَتْ | صَابِرَةٌ (ta-confusion · biasa)<br>صَادِقَةٌ (ta-confusion · biasa)<br>مُؤْمِنَةٌ (ta-confusion · biasa) |
| B2-V1 | B/PRACT | verb-interpretation | خَرَجَتْ | Dia (perempuan) keluar | Dia (laki-laki) keluar (wrong-referent · serius)<br>Dia (perempuan) masuk (lexical · biasa)<br>Dia (laki-laki) masuk (wrong-referent+lexical · serius) |
| B2-V2 | B/PRACT | verb-interpretation | دَخَلَ | Dia (laki-laki) masuk | Dia (perempuan) masuk (wrong-referent · serius)<br>Dia (laki-laki) keluar (lexical · biasa)<br>Dia (perempuan) keluar (wrong-referent+lexical · serius) |
| B2-V3 | B/PRACT | verb-interpretation | رَجَعَتْ | Dia (perempuan) kembali | Dia (laki-laki) kembali (wrong-referent · serius)<br>Dia (perempuan) pergi (lexical · biasa)<br>Dia (laki-laki) pergi (wrong-referent+lexical · serius) |
| B2-W4 | B/PRACT | word-meaning | رَجَعَتْ | dia kembali | dia keluar (lexical · biasa)<br>dia masuk (lexical · biasa)<br>dia pergi (lexical · biasa) |
| B2-Y1 | B/READY | verb-interpretation | سَمِعَ | Dia (laki-laki) mendengar | Dia (perempuan) mendengar (wrong-referent · serius)<br>Dia (laki-laki) masuk (lexical · biasa)<br>Dia (perempuan) masuk (wrong-referent+lexical · serius) |
| B2-D7V1 | B/D7 | verb-interpretation | رَجَعَ | Dia (laki-laki) kembali | Dia (perempuan) kembali (wrong-referent · serius)<br>Dia (laki-laki) pergi (lexical · biasa)<br>Dia (perempuan) pergi (wrong-referent+lexical · serius) |
| B2-D30V1 | B/D30 | verb-interpretation | سَمِعَتْ | Dia (perempuan) mendengar | Dia (laki-laki) mendengar (wrong-referent · serius)<br>Dia (perempuan) masuk (lexical · biasa)<br>Dia (laki-laki) masuk (wrong-referent+lexical · serius) |
| B2-FQ-REF-F | B/FOCUS | verb-interpretation | ذَهَبَتْ | Dia (perempuan) pergi | Dia (laki-laki) pergi (wrong-referent · serius)<br>Dia (perempuan) keluar (lexical · biasa)<br>Dia (laki-laki) keluar (wrong-referent+lexical · serius) |
| B2-FQ-REF-M | B/FOCUS | verb-interpretation | ذَهَبَ | Dia (laki-laki) pergi | Dia (perempuan) pergi (wrong-referent · serius)<br>Dia (laki-laki) keluar (lexical · biasa)<br>Dia (perempuan) keluar (wrong-referent+lexical · serius) |

## Lineage to the v0.1 typed items

Old answers are never re-graded. These mappings only stop old material from counting as fresh again, and let it be scheduled for review.

- A2-M01 ← DEMO-M01 (`A:word-form:صَادِقٌ`)
- A2-F01 ← DEMO-F01 (`A:form:perempuan:نَادِمٌ`)
- A2-P01 ← DEMO-P01 (`A:sentence:هِيَ مُؤْمِنَةٌ`)
- A2-M02 ← DEMO-M02 (`A:word-form:عَالِمٌ`)
- A2-F02 ← DEMO-F02 (`A:form:laki-laki:فَرِحٌ`)
- A2-P02 ← DEMO-P02 (`A:sentence:هُوَ صَالِحٌ`)
- A2-P03 ← DEMO-P03 (`A:sentence:هِيَ شَاكِرَةٌ`)
- A2-R01 ← DEMO-R01 (`A:sentence:هِيَ عَابِدَةٌ`)
- A2-R02 ← DEMO-R02 (`A:sentence:هُوَ كَاذِبٌ`)
- A2-F03 ← DEMO-F03 (`A:form:perempuan:خَائِفٌ`)
- A2-Y01 ← DEMO-Y01 (`A:sentence:هِيَ صَالِحَةٌ`)
- A2-D7S1 ← DEMO-D701 (`A:sentence:هُوَ صَابِرٌ`)
- A2-D30S2 ← DEMO-D3001 (`A:sentence:هِيَ كَرِيمَةٌ`)
- A2-FQ-REF-F ← DEMO-FQ-REF-F (`A:sentence:هِيَ صَادِقَةٌ`)
- A2-FQ-REF-M ← DEMO-FQ-REF-M (`A:sentence:هُوَ صَادِقٌ`)
- A2-FQ-POS ← DEMO-FQ-POS (`A:sentence:هُوَ صَادِقٌ`)
- A2-FQ-ACT ← DEMO-FQ-ACT (`A:sentence:هِيَ صَابِرَةٌ`)

## Excluded or deferred (reported, not padded)

**Glossed bare verbs** are excluded: every GV item in READY/D7/D30/REMED/TRANS/SPARE (سَجَدَ، رَكَعَتْ، نَزَلَ، جَلَسَتْ، ضَحِكَ، نَجَحَتْ، سَكَتَ، شَكَرَتْ، سَجَدَتْ، رَكَعَ، نَزَلَتْ، جَلَسَ).
With the meaning given, a third strong distractor is not available.

**VRB-01 consequences:**
- no REMED item
- one D7 item (رَجَعَ) and one D30 item (سَمِعَتْ), below the source's 2–3 per check
- the progress screen reports this as sparse coverage

**Transfer clashes stay unresolved:** MT-B2/VT1 (هَرَبَ) and MT-B3/VT2 (ضَحِكَتْ). Neither form is used anywhere.

**Not built in this slice:**
- VRB-02 (verb + doer): locked by «VRB-01 learned»
- speech OPR-01/PRC-04: locked by «NOM-01 learned»
- mini readings: their «Orang A atau B» questions are binary
- the entry check and audio (three recordings per item)

**Reserved forms:**
- D7 رَجَعَ and D30 سَمِعَتْ appear only in their own check items.
- سَمِعَ appears only in its READY item; the fifth verb is introduced there.
- رَجَعَتْ is the third VRB-01 practice item. Its word card (B2-W4) is ordered after it.

## Questions for the reviewers

1. **Arabic reviewer:**
   - every vowel mark
   - whether each form-grid distractor (e.g. هُوَ نَادِمَةٌ) is a fair agreement error
   - the كَرِيمٌ sense (E-L5 [CHECK]: mulia or dermawan)
2. **Indonesian reviewer:**
   - the possession phrasings «…-nya (sesuatu yang ia miliki)»
   - the invented-action phrasing «Dia berkata bahwa dirinya …»
   - whether «orang yang saleh / baik» overlaps any distractor
3. **Both:** is each key unambiguous, and is each distractor plausible but clearly wrong?
