# Arabic Trial App — local prototype

Expo SDK 57, React Native 0.86, TypeScript and Expo Router. Learner-facing text is Indonesian; Arabic examples retain their vowel marks and use bundled Noto Naskh Arabic.

## Status and behavior

This is a developer prototype. The bundled `DEMO-*` exercise pack is **synthetic and unreviewed**. Its constructed sentences are not Quran text. The persistent draft notice is visible throughout developer mode.

Implemented behavior:

- Adult consent requires both affirmative checkboxes before participant creation; setup cannot bypass consent.
- Session durations are 10, 15 or 20 minutes. Arabic text size and session duration persist locally.
- Three Unit A lesson screens and seven base practice items, with appropriate focused follow-ups and fresh remediation.
- Typed word/sentence meanings, referent selection and form-choice exercises; ambiguous answers remain pending for human checking.
- Specific feedback, a “Saya belum tahu” action, local issue reporting and factual session counts without mastery claims.
- Atomic answer/snapshot persistence, duplicate-submit protection, save-failure recovery and restart/resume.
- Desktop sidebar, mobile drawer and read-only guide. Browsing the guide does not record learning evidence. Unfinished sessions have an interim summary.
- Resizing between phone and desktop retains unsent answer text and referent choices.

Native persistence uses `expo-sqlite`. The web preview uses browser `localStorage`. There is no backend, remote authentication, upload service or remote configuration fetch. Audio is disabled. The icon files are unchanged Expo template placeholders, with the template notice retained in `LICENSE`; project branding is still undecided.

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

The export commands create JavaScript bundles for web/iOS/Android. They do not build signed native applications or deploy anything. The scripts use POSIX environment syntax (macOS/Linux).

### Switching modes

`EXPO_PUBLIC_APP_MODE` is inlined at bundle time. Stop the previous Metro preview before switching modes, and use the mode-explicit scripts above, which clear the transform cache. Different ports alone do not isolate the cache.

A successful export alone does not prove content gating. A clean tester build must actually render “Belum ada materi yang disetujui untuk uji coba”, with no consent, learner navigation or exercise controls. No approved content pack is included in this repository, so that empty state is the expected tester behavior.

## Verification

The source has 93 Jest tests across 7 suites, plus TypeScript and Expo lint checks. Tests cover scoring/negation, freshness/order rules, consent, both persistence adapters, rollback/concurrency, navigation, read-only guide, interim summaries, resize stability and end-to-end session flow.

Browser QA has covered phone/tablet/desktop widths, correct/wrong/pending answers, serious referent errors, focus/remediation, duplicate clicks, simulated storage failure, reload/resume, reporting, settings persistence and tester gates. Native iOS/Android devices and simulators have not been validated. The local QA captures and session logs are intentionally excluded from this repository.

## Source layout

```text
src/app/          Expo Router screen files
src/ui/           shared components, navigation, lesson panels and theme
src/__tests__/    routed UI flow, navigation and responsive tests
src/config/       pilot rules and validation
src/content/      schema, synthetic fixture, gating and validation
src/engine/       scoring, freshness, session state machine and controller
src/storage/      SQLite/web adapters and storage contracts
test/             Node SQLite adapter for tests only
```

## Draft documentation and remaining work

The design inputs are in `../docs/`, with hashes in `../docs/Source_Copy_Manifest.json`. They are draft design snapshots, not approved exercise content.

Before a real trial: obtain Arabic/Indonesian content approval, resolve the item/form clashes documented in the lesson draft, decide whether typed answers should remain, and finalize privacy/deletion contacts and branding.

Broader pilot work remains: background questions, entry diagnostics/routing, Unit B, review scheduling and D7/D30 checks inside sessions, progress computation, survey, reminders, CSV export, human-check/recompute tools and any backend. Distribution/store builds require separate setup and validation.
