# AyaIlmu native iPhone slice

SwiftUI owner accounts, adult self-profile selection, explicit sync consent, durable owner/origin/learner-bound progress, and a real shared Kotlin session bridge are implemented. Normal resources now contain the exact retained reviewed adult mathematics unit 01: fourteen items and one introduction screen, available in Indonesian and English. This reuses the existing AI arithmetic/language review; it is not new human-specialist or production acceptance. This is a simulator development milestone, not a ready learning beta or TestFlight build. Actual authenticated iOS signup, account/profile and sync lifecycle remains unverified.

The shared framework reads the original Android model/content/engine sources through deterministic import/platform substitutions. `SharedLearningCore/build/generated/shared/source-manifest.json` records original/generated hashes and every substitution; Android algorithms and files remain unchanged. Session planning, scoring, freshness, remediation, feedback, advancement and skill projection call that Kotlin code. Swift renders and saves results; it does not implement mastery thresholds. Kotlin/Native2.2.20 compiled under the selected Xcode27.1 in this environment; that observation is not a claim of vendor-listed SDK support.

Build with project-local approved toolchain/cache paths, without changing global xcode-select:

```sh
export JAVA_HOME=/path/to/JDK22
export GRADLE_USER_HOME=/path/to/task-local/gradle-home
export KONAN_DATA_DIR=/path/to/task-local/konan
export AYAILMU_GRADLE_BIN=/path/to/gradle-8.14.3/bin/gradle
export AYAILMU_KOTLIN_NATIVE_HOME=/path/to/verified/kotlin-native-prebuilt-macos-aarch64-2.2.20
ios/scripts/build-shared-core.sh
DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer \
CLANG_MODULE_CACHE_PATH=/tmp/ayailmu-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/ayailmu-swift-cache \
swift test --package-path ios/AyaIlmuCore --jobs 2 -Xswiftc -j2
```

SwiftPM sandboxing stays enabled. Use the reviewed execution path if the outer workspace sandbox denies macOS `sandbox-exec`; do not disable SwiftPM sandboxing. The native XCTest target requires the actual shared framework and app host; it cannot silently skip the golden comparison. Native tests use only fixtures in test targets. Use `/tmp` derived data for native testing here: Documents-based XCTest artifacts stalled during dependent-bundle loading. The native test target's framework search/link settings must point to the built shared framework, with `REQUIRE_SHARED_CORE` set. Run with an explicit dedicated simulator destination and parallel simulator testing disabled.

Dedicated simulator: `8568898D-1CF8-4B81-8CF9-3CC764D517CD`. Never use generic `booted` commands; another app's simulator is protected. Debug bundle identifier: `id.petalytix.ayailmu.ios.dev`. Build/test jobs are limited to2. The normal artifact must be rebuilt in separate clean derived data after hosted tests; it must contain no test plugins, fixtures, or test manifest.

The app uses the system trust store over HTTPS only (no ATS exception, no custom certificate trust). Release builds reject localhost origins and partial account configuration; without an origin they are account-free. The account build takes its origin, declaration, sync policy and registry source from `-xcconfig` (see `config/release-inputs.example.xcconfig`).

Sessions use app/origin-namespaced Keychain storage. The network capability requires verified provider identity and backend owner. An explicit offline restore can read a previously verified saved identity and local history, but grants no network capability. Successful logout deletes that durable source and fences old capabilities. Backend expiry invalidates the network capability; Restore session or password reauthentication obtains a newly verified one. Local logout and provider revocation outcomes are reported separately.

SQLite lives under app Application Support, excluded from backup, with device file protection where supported. It contains no tokens/passwords/email. Raw immutable Kotlin event payloads, eligibility/outbox acknowledgements, pull cursor and opaque shared session state commit atomically. Retry preserves event bytes/IDs; restart resumes the exact snapshot. Consent opt-out is saved immediately even during an in-flight action; pending withdrawals are flushed for the current owner before further grants/uploads. Pre-consent answers never backfill automatically. Malformed receipts/pages or identity/provenance conflicts stop sync without a success claim.

The verified-resource loader filters approved nonsynthetic adult content, verifies catalog/source and pack/rules hashes, and exposes supported units only. Renderers support choice/true-false, numeric input, estimate slider, pairs, tiles/fill-blank/order, info cards, mini-readings, approved introduction screens and shared feedback. Daily puzzles remain excluded from event sessions; their separate practice UI and advanced activity renderers are not implemented. `AyaIlmu/Resources/ReviewedMath` contains `ApprovedLearning.json` and exact copies of the reviewed pack, rules and backend registry. The source snapshot is `b6e0d6123cb359436f83ce3ae0685198ee13a815`; pack SHA-256 is `7ed58f9684e68f6fef43fcd9ea3e65ff50e530663cec495f207bce20b1bcab0c` and rules SHA-256 is `1871e9d58f00593138026d7adb332b870b31b9cb5c03b874aae0fdfa68440ce9`. No review fields were transformed. The manifest loads both already-reviewed languages and rejects duplicate language/lesson identities, invalid resource names, missing files and provenance mismatches. The screen reports actual content availability and lesson lists/sync proofs use the selected profile language. Existing lesson IDs and stored sessions are unchanged. Tests' other approval fields remain fixture inputs, not curriculum approval.

Current local evidence is outside source under `.runtime/umar-ios-learning-m2` in the parent workspace. The result matrix distinguishes portable tests, actual JVM/native golden parity, simulator-only TLS, and unavailable real-auth/approved-content/device-distribution verification. The unsigned ARM64 device framework also compiles/links against the existing iPhoneOS27.1 SDK. Physical phone app/signing/runtime validation, production infrastructure and live authenticated learning remain separate work. Current curriculum integration evidence is in `../curriculum-evidence`; portable resource tests use the exact shipped bytes. The native-only `testActualNativeSharedCoreStartsAndGradesReviewedMathWithoutAccount` starts and grades these real resources through Kotlin/Native in memory, without an account, mailbox or backend write. Its execution requires the actual native app-host test target; portable SwiftPM does not claim that test ran.

## November 2026 app update

The ordinary account form now checks confirmation fields, gives immediate submission feedback beside the button, and brings final errors into view without scrolling the blank form during startup restore. Failed attempts retain only in-memory inputs for correction; success, mode changes and sign-out clear them. The tested presentation model fences cancelled replies and overlapping restore/submission actions.

Local simulator certificates, generated frameworks, app bundles and device-specific diagnostics are not committed. The Debug source revision matches the bundled reviewed mathematics catalog. Release still requires separately approved origin and policy settings.

Portable tests cover account validation/presentation, privacy boundaries, resources and learning state. Actual signup/email/sign-in/sync and physical-device acceptance are separate pending checks; neither a successful build nor fixture tests establish those outcomes.

### Publication verification (11 November 2026)

- 20 Python configuration, identity and form-regression checks passed.
- 61 portable Swift account/learning tests passed with fixture transports.
- The reconciled source built as an arm64 iOS Simulator Debug app; deep/strict ad-hoc signature verification passed. The existing reviewed Kotlin framework was reused, not rebuilt.
- All four bundled reviewed mathematics resource files match the repository, and no XCTest bundle is embedded in the normal app.
- Local simulator certificates, runtime state and generated products remain outside version control.
- Live signup, email, authenticated progress synchronization and physical-phone acceptance remain pending.
