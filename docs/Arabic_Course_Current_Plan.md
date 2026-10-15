# Arabic Course — Current Plan

**Last updated:** 2026-10-14
**What this is:** the single current reference for the course. It replaces the working drafts (`Opus_Curriculum_Critique.md`, `Opus_Curriculum_Revision_Proposal_v1.md`, and the v2 cohort revision given in chat). Those stay as history. Your original handoff, text extraction, manifest and images are unchanged.

**Companion files**
- `Lessons_Unit_A_B_Draft.md`: the entry check plus the Unit A and Unit B lesson content, in Indonesian, ready for reviewers.
- `Trial_App_Spec.md`: what the trial app must do. It is a description for the build session, not code.

**Status words used below**
- **DECIDED:** you decided it.
- **DEFAULT:** I proposed it and you didn't object. Change it any time.
- **OPEN:** not decided yet.

Nothing here has been tested with learners or checked by a qualified reviewer yet.

---

## 1. What we're building

A guided Arabic course app for Indonesian-speaking adults who can read Arabic script but don't understand it.

Each day the app gives the learner one session:
- a short review of earlier material
- a short new lesson with an explanation in Indonesian
- practice that the app checks
- a mini reading

Mistakes get a specific explanation and a fresh question. Material comes back for review days later, so it is remembered, not just seen once.

The long-term goal is unchanged from your original handoff: understanding the Quran, with a high ceiling. For now, the first release uses **made-up practice sentences only**. The Quran connection is postponed, not dropped.

---

## 2. Decisions

| Topic | Status | Detail |
|---|---|---|
| Long-term goal | DECIDED (handoff, 11 Oct) | Non-Arabic-speaking Muslims understanding the Quran. Serious learning, high ceiling |
| Curriculum first | DECIDED (12 Oct); updated 14 Oct | Lessons are written before the app. The trial app may now be built **in parallel** with the lesson content |
| First learners | **DECIDED** 2026-10-14 06:22 UTC | "Indonesian-speaking adults who can already read Arabic script but don't understand it" |
| What release 1 learners read | **DECIDED** 2026-10-14 | Made-up practice sentences only. No Quran passages for now, neither with help nor alone |
| Explanation language | **DECIDED** 2026-10-14 | Indonesian |
| Listening | **DECIDED** 2026-10-14 | Not in release 1. Learners are not taught or tested on understanding spoken Arabic |
| Method | DECIDED in principle 2026-10-14 ("Sounds good") | Guided daily sessions: flashcard-style word review checked by the app, cloze/form choice, sentence-understanding questions, mini readings, review spaced over days. The exact rules are guesses to test (§7) |
| Platforms | **DECIDED** 2026-10-14 | iOS and Android, on both stores. Store accounts already exist |
| Trial inside the app | **DECIDED** 2026-10-14 | The small learner trial runs in the app, not on paper |
| Trial through test channels before public release | DEFAULT | TestFlight (iOS) and Google Play closed testing first; public listing after the results |
| Reviewers | Candidates exist | An Arabic reviewer and an Indonesian reviewer are in mind. Not named here; Claude does not contact anyone |
| Vocabulary | DEFAULT | Made-up sentences built from words that will be useful for the Quran later (mukmin, saleh, sabar, jujur …) |
| Audio | DEFAULT | Audio only in the entry reading check (about 75 short clips, one recording session). No audio anywhere else |
| Framework, backend | OPEN | Recommendation: one cross-platform codebase for both stores. Decided in the build session |
| Pass rules, review timing | OPEN | Pilot settings (§7), adjusted from trial data |
| Mushaf convention | Deferred | Not needed while release 1 has no Quran text |
| Grammar terms | DEFAULT | Plain Indonesian; Arabic terms only occasionally, in brackets. Revisit after the trial |
| Learners who can't really read script yet | OPEN | They get short targeted help for specific gaps only. No beginner/alphabet course is approved |
| Business model, pricing | OPEN | Not discussed |
| How much content goes into the public release | OPEN | Decide after the trial |

---

## 3. The learner

**What we know (your decision):** they are adults, Indonesian-speaking, and can already read Arabic script, but they don't understand what they read.

**What we must NOT assume, and so check or measure:**
- how well they read **unfamiliar** vowelled words. Reading memorized or familiar text proves nothing here
- any reading without vowel marks
- vocabulary, including Arabic-origin Indonesian words. These may help, or mislead: Indonesian "alim" leans towards "pious", while Arabic عَالِمٌ means "knowledgeable"
- grammar knowledge or terminology
- Arabic typing, which the app never requires

**Indonesian-specific design points**
- "Dia" doesn't show gender, so the app asks "laki-laki atau perempuan?" as a separate question. Natural paraphrases like "Dia jujur" are always accepted.
- Indonesian doesn't mark tense, so "dia keluar" and "dia sudah keluar" are both correct.
- Indonesian doesn't need "adalah", which makes Arabic sentences like هُوَ صَادِقٌ easy to explain.

---

## 4. How a session works (the method)

1. **Review** words and sentences that are due. The app checks the answers; learners never rate themselves.
2. **New lesson step:** a short Indonesian explanation and two worked examples.
3. **Practice:** choose the correct form (cloze-style), give the meaning of a word, say what a sentence means, and answer who it is about (laki-laki atau perempuan).
4. **Mini reading:** 2–3 made-up sentences with questions.
5. **When wrong:** a specific explanation, then a fresh similar question.
6. **Later checks:** a check about 7 days after a unit and another about 30 days after, with new sentences the learner hasn't seen.

**Why this method:** testing yourself and spacing review over days are well supported by research cited in the original handoff. Grammar is taught step by step, because knowing words doesn't mean understanding sentences. **Still unproven:** whether this exact combination works for Arabic, and what the right settings are. The trial is how we find out.

**Borrowed from Sottaku-style apps:** flashcards, cloze, reading questions, example sentences on word cards.
**Done differently:** one guided daily session instead of separate menus; the app checks answers instead of self-rating; grammar is tested step by step; explanations are in Indonesian; no paid attempts, leaderboards or streak penalties.

---

## 5. What the trial contains

| Part | Content | Learner time (guess, to be measured) |
|---|---|---|
| Entry check | About 10 minutes: reading unfamiliar vowelled words, word meanings, simple sentences with glossed words. Results only route learners to short help; they never block anyone | about 10–12 min, once |
| Unit A | "Siapa yang dijelaskan?" — sentences like هُوَ صَادِقٌ / هِيَ صَابِرَةٌ (he/she + description, matching the feminine ending) | several short sessions |
| Unit B | "Siapa yang melakukan, dan siapa yang berkata?" — verbs like خَرَجَ / خَرَجَتْ, a doer after the verb, and قَالَ / قَالَتْ + what was said | several short sessions |
| Later checks | Unit A and Unit B checks at about 7 and 30 days | a few minutes each |

The trial must last **at least about 5–6 weeks**, so that the 30-day checks happen.

---

## 6. Later units (outline only; order not fixed)

| Unit | Topic |
|---|---|
| U-C | الـ (definiteness); "dia adalah *si* …" (definite descriptions); noun + adjective vs sentence |
| U-D | Prepositions (فِي، مِنْ، إِلَى، عَلَى …) and pronouns attached to them |
| U-E | Possession: two-noun phrases, and -hu / -hā ("-nya") |
| U-F | Negation: مَا / لَا (+ "and", "then") |
| U-G | Objects: "he X-ed it/them"; who did what to whom |
| U-H | Present-tense verbs; other persons (I, you, they) |
| U-I | إِنَّ and كَانَ as recognizable chunks |
| U-J | الَّذِي / الَّذِينَ ("who / which") |
| U-K | Commands; "if … then …" |

Each unit includes graded made-up readings. When you decide to bring the Quran back, the plan already describes how to choose passages by what they demand of the reader, how to check which passages learners already know, and how to keep the Quran text exact and clearly separate from the made-up examples.

---

## 7. Settings that are guesses (pilot settings, not standards)

| Setting | Starting guess |
|---|---|
| A skill counts as "learned" | 4 correct of the last 5 fresh questions, including at least 2 typed or built answers, at least 2 different sentences/words, at least 1 reserved question, and at least 1 in a later session (next day or later) |
| He/she-type answers (only 2 choices, so easy to guess) | Need several correct answers in a row, across 2 sessions, before they count |
| Word learned | Correct typed meaning in 2 different sessions |
| Later checks | About 7 and 30 days after the unit; 2–3 new questions per skill |
| Serious mistakes (he↔she swap, "his/her X" possession reading, inventing an action, wrong speaker) | Block "learned" until a focused question and a fresh question are both correct |
| Review spacing between checks | 1 → 3 → 7 days; after a mistake, step back one level |
| Daily session | Learner chooses 10 / 15 / 20 minutes; review takes at most about half |
| Entry check routing | 1 wrong of 2 in a reading feature → short help + re-check; 3+ features flagged → marked "needs reading support", gets help, continues |

The trial app records every answer, so these rules can be changed and recomputed afterwards without asking learners to redo anything.

---

## 8. Order of work

| # | Step | Who | Status |
|---|---|---|---|
| 1 | Current plan, lesson drafts, trial app spec | Claude | Done (these files) |
| 2 | Arabic and Indonesian review of `Lessons_Unit_A_B_Draft.md` (and the audio list) | You send it to your reviewers | Next |
| 3 | Build the trial app from `Trial_App_Spec.md` | New Claude Code build session, in a separate project folder | Can start now, in parallel with step 2 |
| 4 | Record the entry-check audio after the reviewers approve the items | A clear Arabic reader + reviewer | After step 2 |
| 5 | Load only reviewer-approved content; run the trial through TestFlight and Google Play closed testing (Google may require at least 12 testers for 14 days, depending on your account type) | You + build session | After steps 2–4 |
| 6 | Look at the results; fix lessons and settings | Claude + you | After about 5–6 weeks |
| 7 | Decide what goes into the public release, and pricing | You | After step 6 |

---

## 9. Known risks and limits

- **Generic course drift.** With made-up sentences only, the course could drift into generic classroom Arabic. The safeguard is the Quran-useful vocabulary.
- **Reviewer workload.** The lessons need many reviewed sentences. Unit A alone uses 33 practice words, 12 taught (6 pairs) and 21 with a meaning shown (see the lessons file).
- **Automatic marking of typed Indonesian answers is imperfect.** Unclear answers are saved for a human to check later and don't count until checked.
- **A trial of about 12 people shows feasibility and problems only.** It cannot prove the course works better than other apps.
- **The vocabulary hasn't been checked against a word-frequency count.**
- **He/she questions can be guessed.** The pilot rule for them is a guess.
- **Unit B's "verb + doer" sentences need a check by the Arabic reviewer** that they sound natural.

---

## 10. Files in the review folder

| File | Role |
|---|---|
| `Arabic Learning App Complete Discussion Handoff.docx` (+ text, manifest, images) | Original source, unchanged |
| `Opus_Curriculum_Critique.md` | History: first review |
| `Opus_Curriculum_Revision_Proposal_v1.md` | History: first full proposal |
| (v2 cohort revision) | History: given in chat only, not saved |
| `Arabic_Course_Current_Plan.md` | **Current plan (this file)** |
| `Lessons_Unit_A_B_Draft.md` | **Lesson content for review** |
| `Trial_App_Spec.md` | **What the trial app must do** |
