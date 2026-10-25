# AyaFasih — Arabic learning prototype

**Identity:** the current display brand is AyaFasih. The legacy technical slug `arabic-trial-app`, the scheme `arabictrial` and the storage and protocol names are retained for compatibility. A final distinct iOS bundle identifier, Android package and EAS project need owner coordination with Umar and are not configured.

Expo SDK 58, React Native 0.88, TypeScript and Expo Router. Learner-facing text is Indonesian. Arabic keeps its vowel marks and uses bundled Noto Naskh Arabic.

## Status and behaviour

This is a developer prototype.
- **Active content:** the four-choice pack `demo-synthetic-0.3` (item IDs `A3-*` and `B3-*`). It is **synthetic and unreviewed**. Its constructed sentences are not Quran text.
- **History registry:** the previous packs `demo-synthetic-0.2` (`A2-*`, `B2-*`) and `demo-synthetic-0.1` (`DEMO-*`) are kept read-only, only to interpret old answers: their lineages (including retired items such as B2-Y1, B2-D7V1, B2-W4) and the forms each old item actually displayed.
- **Draft notice:** visible throughout developer mode.
- **Content review:** see [`../docs/Four_Choice_Content_Review.md`](../docs/Four_Choice_Content_Review.md) for every key and distractor with its rationale, what is taught before use, the 44 original IDs and what happened to them, retired reservations and open review questions. No qualified Arabic or Indonesian reviewer has approved any item.

**Unit A pilot:** a separate developer-beta loop (worked lessons, practice, held-out transfer, delayed checks) is reachable at `/unit-a-pilot` and is not the legacy four-choice engine described below. See [`../docs/Unit_A_Pilot_Runtime.md`](../docs/Unit_A_Pilot_Runtime.md). Its content is draft and unreviewed.

### Four-choice learning loop

**Every question has four choices.** This covers lesson practice, focused follow-ups, remediation, reviews and timed checks.
- Each question offers exactly four answers: one key and three distractors. Each distractor records its misconception, its seriousness and its feedback.
- «Saya belum tahu» and «Laporkan soal» are separate, quiet controls, not a fifth choice. «Saya belum tahu» is also available on guided focus questions.
- **Accessibility:** the four answers are a labelled group of buttons. After an answer is saved, focus moves to the result heading and a polite status region announces it (it is empty before answering). Each new question or lesson screen takes focus at its heading. A failed save is announced as an alert and takes focus. The report form is a labelled dialog with a radio group of reasons; radio choices (report reasons, session length, Arabic size) select with Space as well as Enter or tap. The web document is `lang="id"`, and Arabic, including Arabic inside Indonesian lesson text, prompts and feedback, is marked `lang="ar"` and drawn in the Arabic font at the learner's Arabic size.
- There is no typing or two-option path.
- **Answer order:** the option order is drawn once when a question is queued and saved with the session. Reload, a save retry or a resize never changes it, and a new attempt gets a new order.
- **What each answer logs:** the order shown, the selected option and its position, the version, and the misconceptions.

**Session order:**
1. Due D7/D30 checks: up to 3 per skill per check, never padded. During a check the app shows only «Jawaban tersimpan»: no key, no right/wrong colour or icon, and the header counts check questions only («Cek ulang 2 dari 8»), so follow-ups queued after a wrong answer do not change it. A check's outcomes stay hidden on Kemajuan and in the session summary until every item of that check (unit × D7/D30) is answered, including when the time budget ends a session mid-check. Follow-ups for a check error wait until the check is complete. While a due check relies on a word, Kemajuan hides that word's meaning, and a serious mistake made in a check is not flagged there until the check is complete.
2. Due reviews: at most half of the planned items, with review time also checked at item boundaries. No review of a key a check exposes the same day.
3. The current lesson. Any lesson screen that teaches a word an item needs is shown before that item.

**Timed checks stay independent retention evidence:**
- Lesson screens passed in a session and screens opened in the Guide are saved as dated views (append-only). The Guide shows a screen only after its view for that visit and day is saved.
- A check is postponed (not used up) on a day its teaching was viewed. If the Guide is opened after the check block was planned, the answers are kept, never shown again, and marked *not counted* (`retention_valid: false` with the view as provenance). Progress and the summary say so.
- When a word table is first introduced after the unit's practice (for example the v0.3 tables reaching a v0.2 learner), checks that rely on it wait their full 7 or 30 days from that introduction. The original practice anchor and history are unchanged.

**Session time:** each step's active time (answer plus feedback reading) is checkpointed when the app goes to the background, the tab is hidden or closed, or the session route is left, and the clock restarts on return. A pause requested while an answer is still being saved is applied from the moment of hiding once the save settles. Hidden or closed time is not charged; each step is capped at 10 minutes. A session left unfinished on an earlier day is archived intact and today's session restores its open follow-ups. The summary shows the recorded active minutes, or «tidak tercatat» when an old session has none.

**Units:**
- Basic Unit B starts once Unit A's lesson screens and core practice items have been attempted. This is practice progression, not a mastery claim.
- READY items left in an earlier unit stay reachable after that.

**Reviews:**
- Reviews follow the provisional pilot ladder of 1 → 3 → 7 days: up one rung when correct, down one when wrong or «belum tahu».
- Nothing is reviewed on the day of the latest exposure, and an overdue item appears once.
- Reviews and checks never count as fresh evidence, and never move a unit's D7/D30 anchor.
- The schedule is rebuilt by replaying the answer log, so there is no separate mutable schedule to drift.

**Progress («Kemajuan»):** it shows facts only:
- attempts and correct choices
- days practised
- review dates and levels
- open serious mistakes
- raw D7/D30 counts, with incomplete coverage, not-counted answers and items waiting for newly introduced teaching stated in words
- a word list of forms actually shown

«Sudah dipelajari», retention and transfer are **not judged**. The source rule requires typed or built answers, and four-choice answers are recorded as recognition only. Old typed answers are counted separately, and pending ones count neither way. VRB-02 and the speech items stay locked until the "learned" rule is decided.

### Saved data and upgrades

Native storage uses `expo-sqlite`. The web preview uses browser `localStorage`. The stored format is version 2; anything marked with a newer version is refused and left unmodified. Every stored answer, learner and report is field-checked on load; malformed data is refused (and shown as a refusal screen) without being changed.

Moving past a lesson screen merges the new seen screen into the learner as currently stored, so settings saved meanwhile on another route are kept.

**One writer on the web:** the tab holding an exclusive Web Lock writes. Another tab of the app opens read-only: it shows a notice, cannot start a session, open the Guide or change settings, and switches to a freshly read writable store once the other tab closes. A tab hands the lock over on `pagehide` (reload, close, back/forward cache) after saving its session checkpoint (waiting for an answer save still in flight); its old store is revoked, and a page restored from the back/forward cache reloads instead of writing. Without the Web Locks API the web preview is read-only.
- **Upgrades:**
  - Old answers, consent, settings, learner ID and reports are never rewritten.
  - A session saved in the old typed format cannot resume. In one atomic write it is archived byte for byte and a new session is saved, followed by a short notice.
  - Material seen under an old ID is not fresh again; it is scheduled for review instead.
- **Safeguards:**
  - A replayed duplicate answer writes nothing.
  - A saved option order that no longer matches the question is set aside, not re-graded.
  - With nothing due, the last real summary is kept.

**Services and assets:** production services are not configured. Optional GoTrue/API account and sync plumbing exists (it can post answers to a local API), is off by default and is not proof of a production service. Remote configuration is not implemented. Audio is disabled. The icons are unchanged Expo template placeholders.

## Commands

Run from `app/`:

```bash
npm ci
npm test -- --runInBand
npm run typecheck
npm run lint
npm run web:dev       # developer-demo, localhost:8081
npm run web:tester    # tester, localhost:8082
CI=1 npm run export:dev
CI=1 npm run export:tester
```

The export commands only create JavaScript bundles; they do not build signed apps or deploy anything. The scripts use POSIX environment syntax (macOS/Linux).

### Switching modes

`EXPO_PUBLIC_APP_MODE` is inlined at bundle time. To switch modes:
1. Stop the previous Metro preview first.
2. Then use the mode-explicit scripts above, which clear the transform cache. Different ports alone do not isolate the cache.

A successful export alone does not prove content gating. A clean tester build must actually render «Belum ada materi yang disetujui untuk uji coba», even with old developer data stored. No approved pack is included.

## Verification

Run the current tests, type check and lint (see Commands) and check CI; this README records no pass counts. The legacy-engine tests cover:
- **Content:** pack validity and hand-checked keys, distractor rules, reserved-form exposure.
- **Answer handling:** shuffle and order persistence, four-choice scoring.
- **Saved data:** v1 → v2 migration, malformed snapshot recovery and future-schema refusal in both stores; malformed web-store refusal; atomic rollback; duplicate replay.
- **Learning:** review dates, including leap-day and year boundaries; session planning; READY reachability; anchors; factual progress; serious-error follow-ups surviving session time limits.
- **Routed UI:** four tiles throughout, migration notice, progress screen, tester gates and direct-route reload during store hydration; neutral check feedback, focus/live-region semantics, read-only tabs, Guide view recording on a retained route, inline Arabic.
- **2026-10-16 repair regressions:** `src/content/__tests__/v03.test.ts`, `src/engine/__tests__/repair.test.ts`, `src/engine/__tests__/exposure.test.ts`, `src/engine/__tests__/checkmask.test.ts`, `src/storage/__tests__/webWriter.test.ts`, `src/__tests__/a11y-checks.test.tsx`.

The browser QA below was done on the **pre-repair** build (v0.2 content); the repaired build still needs independent rendered QA. Independent Chromium QA passed at 320, 390, 768, 1280 and 1440 pixel widths using synthetic profiles and simulated calendar dates. It covered Unit A → basic Unit B, reviews, D7/D30 checks, legacy migration, corrupt-save recovery, failed writes, duplicate taps, keyboard input, reload/resize, settings, reports and serious-error follow-ups across session time limits.

The frozen tester build was rendered through all nine direct routes with legacy developer data: no draft Arabic content or learner navigation appeared, and stored data stayed unchanged. Settings may show existing preferences while its Arabic sample remains hidden.

Web, iOS and Android JavaScript exports pass in both modes. Native iOS/Android devices and simulators have not been validated.

## Source layout

```text
src/app/          Expo Router screens (index, guide, session, summary, progress, settings, dev, consent, setup)
src/ui/           shared components, navigation, lesson panels, notices, learning projection hook, theme
src/__tests__/    routed UI flows (four-choice session, navigation, migration, progress, tester gates)
src/config/       pilot rules (versioned) and validation
src/content/      schema, active and legacy fixtures, gating and validation
src/engine/       scoring, shuffle, freshness, reviews, progress, session planner and controller
src/storage/      SQLite/web adapters (web: Web Locks single writer), storage contracts and field validation
test/             Node SQLite adapter for tests only
```

## Limitations and open decisions

- **Learned rule:** a replacement for the "learned" rule under four-choice answers is pending a product decision. Until then mastery stays unassessed, and VRB-02 and speech stay locked.
- **Sparse Unit B content:**
  - VRB-01 has two remediation items (B3-R1, B3-R2), no READY or D7 item, and one D30 item, below the source's 2–3. Checks stay partial/missing-content.
  - All glossed bare verbs are excluded.
  - The MT-B2/VT1 (هَرَبَ) and MT-B3/VT2 (ضَحِكَتْ) transfer clashes are unresolved, and those forms are unused.
- **Not built:** mini readings, the entry check and audio, background questions, survey, reminders, CSV export, human-check and recompute tools, and any backend.
- **Rendering is not learning:** a saved screen view shows that teaching was displayed, not that it was read or understood. Answers in one check block that share a form (e.g. هِيَ عَالِمَةٌ and عَالِمَةٌ) are not fully independent samples.
- **Before a real trial:**
  - Arabic and Indonesian reviewer approval of every item
  - privacy and deletion contacts
  - branding
  - native device validation
