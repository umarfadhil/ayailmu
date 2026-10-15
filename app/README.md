# Arabic Trial App — local prototype

Expo SDK 57, React Native 0.86, TypeScript and Expo Router. Learner-facing text is Indonesian. Arabic keeps its vowel marks and uses bundled Noto Naskh Arabic.

## Status and behaviour

This is a developer prototype.
- **Active content:** the four-choice pack `demo-synthetic-0.2` (item IDs `A2-*` and `B2-*`). It is **synthetic and unreviewed**. Its constructed sentences are not Quran text.
- **Legacy content:** the typed/binary pack `demo-synthetic-0.1` (`DEMO-*`). It is kept read-only, only to interpret old answers.
- **Draft notice:** visible throughout developer mode.
- **Content review:** see [`../docs/Four_Choice_Content_Review.md`](../docs/Four_Choice_Content_Review.md) for every key and distractor, the excluded items and the reviewer questions.

### Four-choice learning loop

**Every question has four choices.** This covers lesson practice, focused follow-ups, remediation, reviews and timed checks.
- Each question offers exactly four answers: one key and three distractors. Each distractor records its misconception, its seriousness and its feedback.
- «Saya belum tahu» and «Laporkan soal» are separate, quiet controls, not a fifth choice.
- There is no typing or two-option path.
- **Answer order:** the option order is drawn once when a question is queued and saved with the session. Reload, a save retry or a resize never changes it, and a new attempt gets a new order.
- **What each answer logs:** the order shown, the selected option and its position, the version, and the misconceptions.

**Session order:**
1. Due D7/D30 checks: up to 3 per skill per check, never padded.
2. Due reviews: at most half of the planned items, with review time also checked at item boundaries.
3. The current lesson.

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
- raw D7/D30 counts, with incomplete coverage flagged
- a word list of forms actually shown

«Sudah dipelajari», retention and transfer are **not judged**. The source rule requires typed or built answers, and four-choice answers are recorded as recognition only. Old typed answers are counted separately, and pending ones count neither way. VRB-02 and the speech items stay locked until the "learned" rule is decided.

### Saved data and upgrades

Native storage uses `expo-sqlite`. The web preview uses browser `localStorage`. The stored format is version 2; anything marked with a newer version is refused and left unmodified.
- **Upgrades:**
  - Old answers, consent, settings, learner ID and reports are never rewritten.
  - A session saved in the old typed format cannot resume. In one atomic write it is archived byte for byte and a new session is saved, followed by a short notice.
  - Material seen under an old ID is not fresh again; it is scheduled for review instead.
- **Safeguards:**
  - A replayed duplicate answer writes nothing.
  - A saved option order that no longer matches the question is set aside, not re-graded.
  - With nothing due, the last real summary is kept.

**What doesn't exist:** a backend, authentication, uploads or remote configuration. Audio is disabled. The icons are unchanged Expo template placeholders.

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

16 Jest suites with 258 tests pass, as do TypeScript and Expo lint. They cover:
- **Content:** pack validity and hand-checked keys, distractor rules, reserved-form exposure.
- **Answer handling:** shuffle and order persistence, four-choice scoring.
- **Saved data:** v1 → v2 migration, malformed snapshot recovery and future-schema refusal in both stores; malformed web-store refusal; atomic rollback; duplicate replay.
- **Learning:** review dates, including leap-day and year boundaries; session planning; READY reachability; anchors; factual progress; serious-error follow-ups surviving session time limits.
- **Routed UI:** four tiles throughout, migration notice, progress screen, tester gates and direct-route reload during store hydration.

Independent Chromium QA passed at 320, 390, 768, 1280 and 1440 pixel widths using synthetic profiles and simulated calendar dates. It covered Unit A → basic Unit B, reviews, D7/D30 checks, legacy migration, corrupt-save recovery, failed writes, duplicate taps, keyboard input, reload/resize, settings, reports and serious-error follow-ups across session time limits.

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
src/storage/      SQLite/web adapters and storage contracts
test/             Node SQLite adapter for tests only
```

## Limitations and open decisions

- **Learned rule:** a replacement for the "learned" rule under four-choice answers is pending a product decision. Until then mastery stays unassessed, and VRB-02 and speech stay locked.
- **Sparse Unit B content:**
  - VRB-01 has no remediation item and one item per timed check, below the source's 2–3.
  - All glossed bare verbs are excluded.
  - The MT-B2/VT1 (هَرَبَ) and MT-B3/VT2 (ضَحِكَتْ) transfer clashes are unresolved, and those forms are unused.
- **Not built:** mini readings, the entry check and audio, background questions, survey, reminders, CSV export, human-check and recompute tools, and any backend.
- **Before a real trial:**
  - Arabic and Indonesian reviewer approval of every item
  - privacy and deletion contacts
  - branding
  - native device validation
