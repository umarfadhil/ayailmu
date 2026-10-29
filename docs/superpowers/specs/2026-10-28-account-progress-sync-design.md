# Account-bound answer sync and honest progress

Continuation of the owner's approved app implementation; the owner has repeatedly asked to proceed without reopening design questions. Reuse the existing Expo 58 app, account datasets and journal/API contract. No new backend service, source format or automatic networking.

## Current facts and chosen scope

New pilot choices already persist capture intents and guarded answer rows. Manual account sync drains them and sends journal envelopes. Lesson-position documents and exposure records intentionally stay local, and pulled events remain quarantined from the learning store. This slice must not pretend to provide cross-device lesson-position restoration.

Two concrete correctness gaps: the server progress endpoint counts registered events in `events` and stored unregistered events separately in `excluded_unregistered`, but the UI currently labels only `events` as saved answers. Also, a zero `SyncReport.pending` excludes blocked originals, so “Semua jawaban terkirim” can conceal unsent blocked records. Fresh local choices can also arrive while a network sync is in flight.

Chosen approach: preserve the durable journal and backend protocol; add a pure account/profile-bound progress projection, refresh its local queue after a saved pilot choice, and show checked versus unavailable account counts and unsent/held states. Keep network transmission manual and refresh authentication before it. Alternatives rejected: auto-upload (unnecessary lifecycle/network scope), and replaying remote answers into a fabricated local pilot document (insufficient lesson/exposure state in the existing contract).

## Behavior

- A verified server total is registered plus excluded-unregistered events; it is an answer count, never mastery. Missing, invalid, foreign-account/profile or unreadable counts are unknown, not zero. A failed later read may show a clearly labelled last-known count for the same account/profile only.
- Local queue facts distinguish acknowledged originals, sendable queued originals, blocked originals and pending capture. Never announce all sent while any remains unsent or held. New answers arriving during sync remain visible as queued after that sync; do not start another hidden upload.
- A post-save callback reconciles local answer rows into the existing account journal without network. It is scoped to the selected dataset, learner and sign-in binding. Late callbacks after sign-out/switch/reset/data operation cannot publish or write through a different account. Queue notification failure cannot undo a saved choice or ask the learner to answer twice; retry on safe re-entry/manual sync.
- Reviewed beta Home/account UI offers compact factual status and a manual sync action. State explicitly that lesson position remains on this device. Pending content review still blocks study and direct links. Guest/developer paths, explicit consent/copy, refresh-before-sync, export/deletion fencing and deferred recovery remain intact.

## Constraints and validation

Implementation: existing Team/Pro Sonnet 5.5 `xhigh` (requested extra effort), Max Opus `xhigh` only after both included plans are exhausted. Paid usage credits stay off. No credentials, mail, live account changes, new exposure, signing or publication. One writer; all 196 current tracked tests/helpers frozen. Existing test assertions remain unchanged.

Use real stores/journal/SDK with isolated synthetic in-process services for regression tests; label them as fixture proof. No existing authenticated session is available for a new live service acceptance claim. Full tests, type/lint, exports and independent review are required. Native acceptance remains the preserved 8664 checkpoint unless later scope permits a new signed build.
