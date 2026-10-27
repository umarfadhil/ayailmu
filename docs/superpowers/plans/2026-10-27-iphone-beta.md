# AyaIlmu iPhone Beta Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans with one writer in this isolated worktree; read-only review may run independently.

**Goal:** Build a real native owner/learner/lesson/progress path, beginning with an installable simulator account milestone.

**Architecture:** SwiftUI app plus a dependency-free Swift account/API package. Reuse the existing backend wire contracts and planned shared Kotlin learning core; keep Android and its mastery algorithms unchanged.

**Tech Stack:** Swift, SwiftUI, URLSession, Security/Keychain, Xcode27.1; later Kotlin/Native shared-core bridge and SQLite for owner-bound progress.

**Spec:** docs/superpowers/specs/2026-10-27-iphone-beta-design.md

## Constraints

- Separate worktree based on ad8bd595; no publication, signing grants, remote deployment or other app changes.
- No email: AyaIlmu4/4 is exhausted. Live probes are health/protected-route checks only.
- Debug app-only CA trust is exact localhost58443 with hostname verification; production keeps system trust.
- Real approved content and registry proofs are mandatory before lesson availability; no synthetic beta substitute.
- Dedicated AyaIlmu simulator; preserve AyaFasih's iPhone Duo.

## Review focus

- Late restore/login must not resurrect a signed-out account.
-403 bad_jwt expiry is refreshable; unrelated403 remains denied.
- Rotated provider subject or backend owner mismatch must fail closed.
- Failed Keychain writes/deletes must not pretend an account operation succeeded.
- Redirects, invalid origins, wrong TLS host and test trust in Release must be rejected.

## M1: Runnable native account slice

Files: ios/AyaIlmuCore/Package.swift; Sources/AyaIlmuCore/{Configuration,Contracts,HTTPClient,AccountStore,SessionVault}.swift; Tests/AyaIlmuCoreTests; ios/AyaIlmu/{AyaIlmuApp,AccountView,KeychainVault,PrivateQATrust}.swift; Info.plist; AyaIlmu.xcodeproj; scripts/build-private-qa.sh.

- [x] Write account tests before implementation; initial test launch hit cache permissions rather than assertions. Subsequent concurrency/storage/credential regressions were observed failing and then passing; no claim that every initial test witnessed an assertion RED.
- [x] Implement the Swift package against Android GoTrueAuth.kt, HttpBackend.kt and NormalAccount.kt. Backend owner activation is POST/v1/account with declaration_version, adult_confirmed=true, synthetic=false. Restore is GET/v1/account without repeating declaration.
- [x] Implement Keychain vault and normal account UI, with unavailable optional sign-in absent.
- [x] Build/test with Xcode27.1, install on the dedicated unsigned simulator, verify actual launch and private HTTPS health200/protected user401; no email/account submission.18 package tests and7 build-guard tests pass.
- [x] Independent review, two recovery repairs and final re-review. Real authenticated iOS lifecycle/Keychain writes remain unverified under the no-mail limit; this account milestone is not a complete learning beta.

## M2: Shared learning-core bridge and parity

- [ ] Identify the smallest model/content/engine subset needed for the selected unit; isolate JVM clock/normalization/IO behind platform adapters without changing Android results.
- [ ] Build an iOS framework and run the same answer/scoring/freshness fixtures on Android/JVM and iOS. No new Swift mastery thresholds.

## M3: Adult learner and durable account-bound progress

- [ ] Implement /v1/learners list/create for permitted ADULT self-profiles and lang id/en; explicit /consent version; store local identity by backend owner/learner.
- [ ] Implement atomic SQLite answers/outbox, stable immutable event IDs/payloads, idempotent append and cursor pull; fence logout/owner changes.
- [ ] Test restart, retry, duplicate replay, server readback and cross-owner isolation using separately authorized fixtures. Do not delete existing user data.

## M4: Real starter lesson

- [ ] Obtain actual review of adult math Unit01, including its18 entries and lesson screen in ID/EN; produce new immutable content/version/proof bundle after approval.
- [ ] Correct the two confirmed lesson/card wording defects in draft version mat-a-pemula-0.3; independently recheck18 Unit01 keys and preserve all grading fields/draft statuses. Frozen backend registry remains unchanged; this is not approval or runtime activation.
- [ ] Add native renderers for its supported activities with shared-core results, save-before-advance and honest progress. Keep unsupported/unreviewed content unavailable.
- [ ] Verify lesson → offline restart → sync/replay → logout/login → restored progress on actual iOS and Android targets.

## M5: Owner phone beta

- [ ] Consume the infrastructure owner's verified stable HTTPS API/auth/issuer.
- [ ] Confirm existing Apple team and distinct AyaIlmu identity. Obtain exact signing/device/upload approval before any provisioning or TestFlight action.
- [ ] Produce platform artifacts, verify hashes/config/privacy surface, then test the owner's physical phones. No beta-ready claim before this evidence.
