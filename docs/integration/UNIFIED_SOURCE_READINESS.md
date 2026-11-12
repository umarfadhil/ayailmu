# Unified local release source

12 November 2026. Source integration only, not public-launch approval.

## Integration boundary

Worktree: `/Users/amarmaruf/Documents/Codex/2026-11-12/ayailmu-unified-source/checkout`.
Local branch: `feature/ayailmu-release-unification-20261112`.

Committed Android/backend parent `3225f521784debd40ca50871ee977969b3bc55be` and iOS parent `45b6206011734fdb9a4fe7aefcb9f67614a7abb1` were merged from common base `ad8bd59544a3ba901988761a877d10b04647f6e2`. Their histories diverged by eight and four commits. The merge had no textual source conflict. The reviewed local Android/backend and iOS checkpoints were then applied. Their session-note patch overlapped; notes/file map were combined manually rather than replacing either history.

Both original worktrees remain separate. Verified preservation covers original HEAD/branch, staged entries, porcelain status, tracked/non-ignored untracked file inventory and every recorded source byte (1,940 Android/backend files, 1,901 iOS files). This does not claim byte-identical Git stat-cache bookkeeping or ignored build/cache directories.

The unified Android/backend subtree matches its original current source except for the existing iOS-branch adult-math draft v0.3 update. That commit changes 145 version fields and four localized wording fields; item IDs and all 158 draft review states are unchanged. It does not approve curriculum. Reviewed production assets retain their exact prior hashes. All 53 iOS files match the canonical integrated iOS source, including preserved project identity/trust configuration and no KeychainStatus debugging.

## Combined verification

- Android: 688 reported tests, 677 pass and 11 optional live-wire skips; zero failures/errors. Pack validation, unsigned prod/demo assemblies and both lint variants pass. Lint reports 0 errors, 639 warnings and 3 hints. ktlint is report-only and prints existing violations, not a clean style pass. Six exact asset/APK checks pass.
- Android release inputs: 12 actual-Gradle test groups pass. Normal default CI build was restored after fixture configuration tests; no fixture identity or origin was used to build the final APK. The APK remains an unapproved offline/private candidate, not a public-release artifact.
- Backend: full fresh disposable-PostgreSQL race suite has 157 top-level passes and two subprocess-helper skips. Go vet/build and seven tunnel tests pass. No live database/account is used.
- iOS: 96 Swift and 25 Python source/configuration checks pass in the unified checkout. Unsigned ARM64 simulator app compilation passes using the separately hash-verified existing native framework. All current bridge source inputs match that framework's recorded source fingerprint.
- Fresh shared JVM verification: exact cached Kotlin 2.2.20 compiler plus serialization 1.9.0 compile the current generated bridge source directly; its deterministic JUnit golden fixture passes and matches the previous golden exactly.
- Independent source/provenance review confirms preservation, no lost owned-source changes and the disclosed draft-content delta. All original staged-entry hashes and source bytes were independently rechecked.

**Not passed:** the official offline shared-bridge Gradle gate lacks cached plugin/dependency artifacts, and a fresh Kotlin/Native rebuild is blocked by the missing local Kotlin 2.2.20 native compiler/dependency bundle. No compiler was downloaded or substituted. A reused native binary is not proof of a fresh native rebuild. Restoring the approved exact toolchain and rerunning that gate remains required for fully reproducible native release builds.

The detailed logs, baseline/comparison manifests, source hashes and exact command/exit evidence are outside source in the Mac's `2026-11-12/ayailmu-unified-source/` directory; the iOS verification split is documented under `ios-verification/README.md`.

## Release gates remain open

This work chooses no real public identity, domain, policy, provider credential or signing key. Default builds still do not represent a connected public release. Approved public configuration and source-to-deployment matching, real Auth/mail/recovery/sync/deletion lifecycle, native secure-storage/device interruption acceptance, full curriculum and iOS/family/renderer/puzzle parity, commerce/restore/refunds, web deletion process, retention/backups, signing/store acceptance and monitored rollout remain open.

See `ACCOUNT_ERASURE_READINESS.md`, `PUBLIC_RELEASE_INPUTS.md`, and `ios/README.md`. No user data was erased, fake service account created, real email/password operation performed, app installed/launched, source pushed, production deployed or store submission made. Local source integration does not reduce the requested full-feature scope to the one reviewed adult-math unit.
