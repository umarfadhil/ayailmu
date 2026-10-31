# Normal-user starter: candidate report

Status: a bounded candidate behind an inactive build opt-in. Its content has a compiled, owner-authorized, AI-only trial
acceptance (below). It is not a release, not an activated or published build, and not human or expert certification. This
documentation task ran no command, runtime, network call or reviewer, and simply did not activate any service.
Configuration context is in [GENERAL_USER_PROFILE.md](GENERAL_USER_PROFILE.md).

## Candidate content

- 2 lessons, 3 worked examples and 20 multiple-choice questions: 8 practice, 4 transfer, 4 at D7 and 4 at D30.
- Four answer choices only. The text is constructed for this app and is not Quran text. It remains a synthetic,
  constructed draft, and its authored metadata is unchanged by the acceptance.
- `contentVersion`: `unit-a-pilot-draft-0.1`
- Content JSON sha256: `5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e` (replaces the earlier
  `5dba7f7bd8381255088fc25980007707d6a4783238ea8bdc6eb651fc536f45fc`; `contentVersion` is unchanged).
- A narrow wording correction changed exactly 4 lesson-body sentences. All 3 examples and all 20 items, options, keys,
  explanations, IDs, phases and provenance are byte-equivalent.

## Trial acceptance (actual compiled record)

The compiled `UNIT_A_STARTER_REVIEW` in `src/pilot/unitA/review.ts` is `approved-for-trial` for exactly the content
version and sha256 above.

- One reviewer: a single coordinating AI assistant, `/root/check_fasih_expo`, recorded once under each of the three
  categories (Arabic, Indonesian, assessment). These are not three reviewers.
- It reviewed all 20 questions at `2026-10-30T10:11:08Z`, after reading the 2 lessons, 3 examples and 20 questions with
  their options, keys and explanations. It accepted the 4 corrected teaching sentences at `2026-10-30T10:25:22Z`; the
  record's `reviewedAt` is `2026-10-30T10:25:22.000Z` in all three sections.
- Scope: 2 lessons, 3 examples and 20 multiple-choice questions, with all keys found correct and unambiguous in the
  specified constructed singular patterns.
- The owner explicitly authorized trial acceptance on the basis of this substantive AI assessment.
- It is not independent human, expert, efficacy or mastery certification. No signature or expiry is recorded.
- The compiled record is separate from the content and grants exact trial access only. Any later edit, hash or version
  change denies access again until the content is reviewed anew.
- The gate validator (`starterReviewAccess`) is unchanged. Pending, stale and malformed denial coverage is retained,
  using explicit fixtures. No fixture identity or progress ships.

## Gate

- `EXPO_PUBLIC_NORMAL_USER_STARTER=on` grants build eligibility only. It must sit on the exact normal production
  confirmed-email profile: strict public roots; QA, private beta and learning beta off; remember-device `on` or `off`.
- Google sign-in and password recovery may each be requested `on` or `off`, independently
  ([GENERAL_USER_PROFILE.md](GENERAL_USER_PROFILE.md)). Eligibility does not depend on them and neither can approve
  content.
- No setting, env value or capability approves content; only the compiled record does. Every operation rechecks it, and a
  pending, stale or malformed review, or no activity, stops the route before anything is stored.
- With the compiled acceptance, an otherwise eligible normal build can offer the study route. No such build has been made
  or activated here.

## Account and data

- Account answers use the existing canonical dataset (Active), the capture learner id and the answersSaved provider
  journal. Missing progress is shown as unavailable. No identity, count or mastery is invented.
- The account-isolation, progress and missing-progress safeguards are unchanged.
- Metadata and progress stay on the device. Only answers actually captured sync, through the existing manual client.
- No cross-device lesson position is promised.

## Quality provenance

- An earlier AI technical inspection mapped 20 of 20 declared answer keys to a bounded grammatical reading. The
  coordinating assistant's assessment above is the one the record rests on.
- The 4 corrected lesson-body sentences:
  - The reference pattern is scoped to this unit and admits noun subjects.
  - Agreement is scoped to regular singular adjectives.
  - The gender statement refers to grammatical gender, not biological sex.
  - The pronoun example is scoped.
- The supplied glosses check grammatical mapping and recombination. They do not show unaided vocabulary or Quran
  comprehension.

## Verification

Local checks only. None is live-service, mailbox, network, native or phone acceptance.

- Current: the focused acceptance/core run passed 161 tests. The normal rendered route and provider tests now use the
  genuine compiled acceptance where appropriate, and the actual-default controller adds duplicate-submission prevention.
  Their networks and stores are isolated and synthetic, never live-backend or device proof.
- Final acceptance verification: 2,442 passed, 2 existing skips in 213 suites; TypeScript passed; lint reported 0 errors and 8 existing warnings. The result line was filled from completed receipts; no runtime or test code changed afterward.
- Historical, from before this acceptance: the last capability aggregate was 2,426 passed and 2 skips in 212 suites, with
  lint at 0 errors and 8 existing warnings and `tsc --noEmit` exit 0. The optional Google and recovery counts (51 Google
  configuration, 6 constructor, 1 real-SDK protocol, 4 panel, 3 provider and 190 profile cases) and the three scope/key
  regression cases (2 failed before the wording correction, then all 3 passed) are likewise historical.
- Historical only: the prior phase 122 JavaScript exports (web and iOS/Android Hermes, fictional public roots, pending
  review record). There is no current build or export, and they were never native compilations or installable apps.
- No native, phone, live-backend, Google, SMTP or TLS proof is claimed, and no recovery link was exercised.

## Activation

The shortest path is the existing normal-user path with:

- An actual approved stable host and two DISTINCT public-CA HTTPS root origins for the API and Auth (standalone GoTrue,
  no `/auth/v1`).
- Matching issuer, audience, JWKS and account identity.
- Normal confirmed-email enrollment, mail and callback scope.

Current state:

- The retained localhost private-CA setup and the recipient-held mail gateway are not normal public signup and are not
  reachable from a phone.
- Domains and host are not configured or verified. No names are invented here.
- The last SMTP handoff only recorded Brevo Free (300/day) and an AyaFasih key valid through 2026-11-02. Current capacity
  and key status were not checked. No private recipient or credential details are documented.
- Google and recovery are validated locally as capabilities. The actual provider and callback configuration is unverified.
  Neither is arbitrarily forced off, and when a requested method is unavailable it fails securely and says so.
- SDK 58 Expo Go may support the standard public-TLS email, one-time-code and storage path (SQLite and SecureStore are
  supported), but the actual phone is unverified. The custom native Google and recovery callbacks need an owned native
  build, and the private-CA bridge is absent from Expo Go.
- Signing, delivery, publication and live activation each require separate authority.
- Manual recovery: owner deferred, not passed.
- There is no current public QR code.
