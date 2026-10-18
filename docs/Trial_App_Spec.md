# Trial App Spec (Arabic track, evidence mode)

> **Current scope notice (2026-10-17):** the Android-only statement in §3 and no-backend policy in §12 record the earlier baseline. Current direction is Kotlin Android and Swift iOS at launch, with a separately approved local backend workstream; see [`../ai-memory/PROJECT_OVERVIEW.md`](../ai-memory/PROJECT_OVERVIEW.md). This integration contains no backend implementation. The current four-choice Arabic reference behaviour is documented in [`../prototype-expo/README.md`](../prototype-expo/README.md); native Arabic remains typed/binary v0.1, and parity with that reference is not established.

**Status:** behaviour spec for the Arabic trial, written 2026-10-14; **trimmed 2026-10-16** after the project became AyaIlmu. Sections that were decided or superseded now point to `ai-memory/` instead of repeating it. What remains (purpose, scope, learner flow, question types, planner, learning rules, progress screen, content format, data stored, privacy, acceptance checks) is still the authoritative detail for the Arabic track and is referenced by `docs/syllabus/01_BAHASA.md`.
**Inputs:** `Arabic_Course_Current_Plan.md` (decisions), `Lessons_Unit_A_B_Draft.md` (content). **Only reviewer-approved content may be shown to testers.**

---

## 1. Purpose

A small app to run the learner trial for the entry check, Unit A and Unit B, with checks at about 7 and 30 days.

**The trial must answer:**
1. Can testers follow the lessons without a teacher?
2. Do the questions separate reading problems, word-meaning problems and sentence-understanding problems?
3. Do learners who reach "learned" still answer correctly at 7 and 30 days?
4. Can they understand new sentences built from what they learned?
5. Which mistakes are common, and does the follow-up help fix them?
6. How long do sessions and units take? How many testers drop out?

**It cannot prove** that the course is better than other apps. Don't claim that.

## 2. Scope

**In:**
- welcome and consent
- background questions
- entry check (with audio)
- short reading-help screens
- Unit A and Unit B lessons, practice and mini readings
- the daily session planner
- 7- and 30-day checks
- the progress screen
- in-app feedback
- answer logging and data export

**Out:**
- payments, ads, subscriptions
- leaderboards, ranks, currencies, streak penalties
- social features or messaging
- AI tutor or chat
- listening exercises
- Quran text
- Arabic typing
- user-generated content

## 3. Platforms and distribution

**Decided 2026-10-16 — see `ai-memory/PROJECT_OVERVIEW.md` (Stack, Play policy posture).** Android only, Kotlin + Jetpack Compose; iOS is not planned. Distribution via Google Play closed testing (≥ 12 testers, 14 days) before production; trial length at least 5–6 weeks so D30 checks happen; no public listing of the Arabic track until results are reviewed.

## 4. Learner flow

1. **Welcome** (Indonesian): what the app is and what the trial involves.
2. **Consent** (Indonesian, §11). The learner confirms they are 18 or older, agrees to their answers being stored, and is told they can stop at any time. No consent, no data collected.
3. **Background questions** (E-B1–E-B4).
4. **Entry check** (Part 1 of the lessons file), with resume support. Reading-help screens are inserted by the routing rules.
5. **Home:** «Sesi hari ini», showing the planned session length and one start button.
6. **Daily session** (§6).
7. **End of session:** a short summary — what was practiced, what is due next. No streak loss and no guilt messages.
8. **Progress screen** (§8).
9. **Later checks** appear automatically in daily sessions when due.
10. **Trial survey:** a short in-app questionnaire at about day 7 and at the end of the trial (§10).

**Optional notification:** one daily reminder at a time the learner chooses. It can be turned off.

## 5. Question types (what the app must support)

All Arabic is shown with full harakat, right-to-left, in a font that renders vowel marks clearly. Arabic text size can be changed and must never be stripped of marks.

| Type | UI | Scoring |
|---|---|---|
| Audio-match (entry check) | Arabic word/phrase + 3 audio buttons (play any number of times) + choose | Correct / wrong. If audio fails to load → "not assessed", never wrong |
| Choose (2–4 options + «Saya belum tahu») | Buttons | Correct / wrong / don't know (don't know ≠ wrong for routing; treated as not correct for learning rules) |
| Q-REF / he-she | 2 buttons: laki-laki / perempuan | Correct / wrong. Tagged **binary** |
| Q-MEAN / Q-PARA typed Indonesian | Latin keyboard text field | Auto-scoring rules in the lessons file, §2.6: correct / wrong-known-error / **waiting for human check**. The raw text is always stored |
| Q-TILE | Arabic word stem + 4 ending tiles | Correct / wrong. Tagged **built** |
| Q-SPK | Three sub-questions on one screen | Each sub-part scored separately |
| Mini reading | Text + several questions | Each question scored separately; each sentence's parts count once toward its skill |
| Help line | «Bantuan: [word] = [meaning]» under the sentence | Logged as "meaning shown" for that word |
| Hint button (instruction/guided only) | Reveals one step | Any item answered after a hint = practice, not evidence |

**Every item screen** has a small «Laporkan soal» (report this question) button with a short reason list and a free-text field.

**Mini readings and lesson starts** carry the label «Kalimat latihan buatan — bukan ayat Al-Qur'an».

## 6. Daily session planner (simple rules for the trial)

**Session length:** the learner chooses 10, 15 or 20 minutes. The default comes from E-B4.

**Order inside a session:**
1. **Due later checks** (D7/D30), if any. They always come first and are short.
2. **Due reviews.** Words and already-seen sentences, spacing 1 → 3 → 7 days. After a mistake, step back one level. Reviews use at most about half of the session. Review answers are practice, not evidence for "learned".
3. **The current lesson step:**
   - the next screen
   - guided practice
   - practice items
   - learned-check items
   - follow-up after a mistake
   - mini readings
4. **Stop** at the time budget, at the end of the current item.

**Unlocks:**
- Unit A, then Unit B. The entry check comes first; reading help is inserted where routed.
- Unit B speech items (OPR-01, PRC-04, the speech parts of mini readings) need NOM-01 = learned.
- VRB-02 items need VRB-01 = learned.

**"Later session" means a different calendar day** (pilot setting).

**Running out of fresh questions:** if a skill uses up all its fresh items without reaching "learned":
- mark it "not yet learned — out of fresh questions"
- let the learner continue
- flag it for analysis

Never reuse a seen item as fresh.

## 7. Learning rules (pilot settings; all in a config file, not hard-coded)

**Configuration:** all values below must live in a configuration file that can be changed **without an app update** (e.g., fetched at app start).

**Every answer is stored**, so all states can be recomputed offline later with different rules.

**Fresh evidence** = first attempt on the item, no hint, no answer shown earlier, not repeated after feedback, and the item never seen before by this learner.

| Rule | Starting value |
|---|---|
| Skill "learned" | Among the last 5 fresh attempts: ≥ 4 correct; ≥ 2 typed or built (Q-TILE counts as built **only if** config `tile_counts_as_free = true`; default **false**); ≥ 2 different words/sentences; ≥ 1 from READY; ≥ 1 on a later day; no unresolved serious mistake |
| Binary parts (he/she, speaker) | Need `binary_streak` = 4 correct in a row across ≥ 2 days, mixed order |
| Word learned | Correct typed meaning on 2 different days |
| Serious mistake | Wrong he/she on a sentence item, possession reading, invented action, doer read as object, wrong speaker. Blocks "learned" until the focused question and a fresh REMED item are both correct |
| D7 check | 7 days after the unit's last practice. 2–3 items per skill. Outcomes: remembered / not remembered / unclear (→ one more item) |
| D30 check | 30 days after the unit's last practice, same format, different items |
| Typed answers waiting for human check | Count as neither right nor wrong |
| Review spacing | 1, 3, 7 days; step back one on a mistake |
| Review share of a session | ≤ 50% |
| Entry routing | Lessons file §1.9 |

## 8. Progress screen (learner)

For each unit, three separate lines:
- **«Sudah dipelajari»** — learned
- **«Masih ingat setelah 7 / 30 hari»** — remembered
- **«Bisa memahami kalimat baru»** — new-sentence transfer

Plus a word list, with each word marked learned / still practicing.

**No** single combined percentage, badges, ranks or comparisons with other people.

## 9. Content format (what the build session converts the lessons file into)

**One content file per version.** Item IDs are exactly as in the lessons file.

| Field | Meaning |
|---|---|
| item_id | e.g. C04, X01, F03, VS06, E-D05 |
| unit | ENTRY / A / B |
| type | audio-match, choose, q-ref, q-mean, q-para, q-tile, q-spk, q-doer, q-vn, mini |
| skills | Skill IDs it gives evidence for (NOM-01, LEX-A:W-A3, …); which parts score which skill |
| pool | INSTR, PRACT, READY, D7, D30, REMED, TRANS, SPARE, MT, ENTRY, REPROBE |
| arabic | Exact text with full harakat |
| constructed | Always true in this trial |
| help_lines | Word + meaning shown under the item |
| prompt_id | Points to the Indonesian learner text |
| options | For choice items, with the correct one marked |
| accepted | Accepted typed answers + known-error patterns |
| feedback_ids | FA-* / FB-* messages per outcome |
| audio | Clip files for audio-match options (entry check only) |
| order_constraints | E.g., "after NOM-01 learned", "not before D7 of VRB-01", "later day than first READY" |
| review_status | draft / reviewed-arabic / reviewed-indonesian / **approved-for-trial**. The app shows only approved-for-trial |
| content_version | Version label |

**Ordering constraints to implement**, beyond the pools:
- Lessons file §3.5: VRB-01 D7/D30 forms must not appear anywhere earlier.
- Speech items use only Unit A sentences already seen.
- **Known clashes to resolve before loading** (found after the lessons file was written):
  - **MT-B3 uses ضَحِكَتْ** and **VT2 also uses ضَحِكَتْ**.
  - **MT-B2 uses هَرَبَ** and **VT1 also uses هَرَبَ**.
  - VT1/VT2 are meant to use unseen verbs. Either swap the verbs in MT-B2/MT-B3, or replace VT1/VT2, during review.

## 10. Data stored (per answer)

| Field | Meaning |
|---|---|
| learner_id | Random ID created on the device; no name or email needed |
| item_id, content_version | What was shown |
| timestamp, session_id, local date | When |
| raw_response | Exactly what was tapped or typed |
| auto_score | Per part: correct / wrong / waiting / not assessed |
| error_tags | E.g., wrong-referent, possession, invented-action, ta-confusion, decoding |
| hint_used, help_lines_shown | Help used |
| first_attempt | Yes/no |
| time_on_item | Seconds (analysis only; never used to judge the learner) |
| audio_status | Played / failed (entry check) |
| report_flag | If «Laporkan soal» was used |
| app_version | — |

**Also stored:**
- background answers
- consent record (time, version)
- survey answers
- computed skill states, each with the rule-config version used

**Survey (Indonesian, short):**
- clarity of explanations (1–5)
- hardest part (text)
- would you continue (yes/maybe/no)
- daily time actually spent
- anything confusing (text)

## 11. Privacy, consent and safety

- **Collect the minimum.** No names, contacts, location or photos are needed. A random learner ID only.
- **Consent screen** in plain Indonesian:
  - what is collected
  - why (to improve the lessons)
  - who can see it (the course team)
  - how long it is kept
  - how to stop and ask for deletion
- **Adults only (18+).**
- **Privacy policy URL.** Required by both stores; it must match what is actually collected.
- **Deletion requests** via a contact address shown in the app. The learner ID is shown in Settings so they can quote it.
- **Indonesian law.** Check Indonesia's personal data protection law (UU No. 27/2022, UU PDP) and the store data-safety forms before release. Get proper advice if unsure.
- **Data in transit** is encrypted. Access to the database is limited to the team.

## 12. Offline behavior

**Superseded 2026-10-16 — see `ai-memory/PROJECT_OVERVIEW.md` "Spec deviations" and `ai-memory/CODE_RULES.md` CR-DAT-4.** There is no backend: lessons, items, config and the ~75 entry-check audio clips are bundled; every answer is stored on the device (Room) and nothing is uploaded. Nothing is lost if the app closes.

## 13. Data export and analysis

**Superseded 2026-10-16 — see `ai-memory/CODE_RULES.md` CR-DAT-4.** Testers export all answers, states, surveys and reports as JSON + CSV from Settings via the Android share sheet. The human-check workflow for "waiting" typed answers runs in a spreadsheet on the exported file; the recompute tool runs on exported files outside the app.

## 14. Before inviting testers (acceptance checks)

1. **Content:** every item shown is marked approved-for-trial by both reviewers, and the two known clashes are resolved.
2. **Audio:** all 75 entry-check clips play correctly on test devices. An audio failure shows "not assessed".
3. **Typed-answer scoring:** tested with a sample list of right, wrong and borderline Indonesian answers, prepared with the Indonesian reviewer.
4. **Freshness and order:**
   - a test learner never sees a READY/D7/D30 item early
   - reserved verb forms never appear early
   - speech items use only already-seen sentences
5. **Rules:** changing the config changes the behavior without an app update. Recomputing from stored answers reproduces the in-app states.
6. **Data:** answers arrive in the database; offline answers sync later; export works.
7. **Consent and privacy:** the consent screen works; the privacy policy is live; the store data-safety forms are filled in.
8. **Arabic display:** harakat render correctly on several iOS and Android devices and font sizes.

## 15. Decisions left for the build session (or for Amar)

All decided 2026-10-16 — framework, backend, config location, analytics (none), app name: see `ai-memory/PROJECT_OVERVIEW.md` and `CODE_RULES.md` §7 (Config). Open items live only in PROJECT_OVERVIEW "Open decisions".

## 16. How to start the build

Obsolete. Build sessions start from `ai-memory/README.md` in this repo (CODE_RULES CR-SES-1).
