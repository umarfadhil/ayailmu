# Account progress sync verification — 2026-10-29

## Implemented behavior

Saved Unit A answers notify only their original writable account dataset. The provider reconciles them into the durable local journal without starting a network request. Manual sync still refreshes authentication before sending. An answer saved during an upload joins the next local queue rather than silently entering the batch already in flight.

Home and Account distinguish answers waiting to send, blocked answers, conflicts, held capture and verified/last-known/unknown account totals. Server totals include registered answers plus stored unregistered answers; these counts never imply mastery. A missing or foreign account/profile receipt never becomes a verified zero. Current lesson position remains on this device; this work does not invent a cross-device lesson-state contract.

Generation, learner and account guards cover the notification and journal-document write itself. When an answer-row append fails after its capture intent was saved, the screen now reports that held state. A sync already in flight cannot overwrite a newer held notice with an earlier drain result. Re-entry retries the existing capture, queues its row once and clears the stale held message.

## Verification

- Full Jest suite: **2,014 passed, 2 skipped, 191 suites passed**, no failed suites/tests.
- The two skips are KvStore variants of SQLite-only INSERT/commit rollback hooks; the SQLite counterparts execute.
- TypeScript `tsc --noEmit` and project Expo lint: exit 0.
- All **205 frozen files** unchanged, including the original 196 test/helper files and nine new regression files frozen before implementation.
- New held-capture integration cases were observed failing with `capturePending` false before the repair, then passed. The final focused UI/provider set passed all 15 cases.
- Web, iOS and Android JavaScript/Hermes exports: exit 0. Configuration used explicit compile-only fixture origins/IDs, with no live backend or delivery configuration.
- Final export in the browser on the owner's Mac: Home and direct lesson URL remain pending review; Back returns Home; Account navigation and empty-form disabling pass; zero console errors. No credentials submitted. Temporary loopback server and tab closed afterward.
- Independent read-only Opus source review found one Important held-capture reporting gap. The two regressions and repair above address it. A subsequent review found no remaining Important/Critical defect in that repair. The coordinator checked Git scope and frozen hashes separately.

## Limits and follow-ups

This is a local source checkpoint, not an installable mobile beta or production-readiness claim. No new native build, signing, install, upload, email, credential operation, backend restart or public exposure occurred. The existing simulator build predates these changes. Private-QA native CA transport requires a custom native build and cannot be supplied by Expo Go.

At readiness inspection, local API/Auth ports were not listening, and historical remote QA access had expired. Content review remains pending; the reviewed-content UI is covered using explicitly fictional test fixtures, not by changing compiled approval status. Manual native password-recovery acceptance remains owner-deferred.

The legacy profile-choice high-sequence label and status after export interrupts a sync remain minor follow-ups from review. Provider notification errors preserve the answer and show pending capture on Home/Account; the screen's generic callback-failure fallback is tested separately. A held notice conservatively may outlast a successful simultaneous drain until the next screen load/manual sync; it does not claim successful delivery. No source changes for unrelated follow-ups are included.

Before phone delivery: verify a stable approved reachable HTTPS backend and real beta auth configuration, complete starter-content review, and establish approved Apple team/app identity/signing/distribution access. Existing source/tests/exports do not satisfy these gates.
