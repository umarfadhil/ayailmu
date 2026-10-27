# AyaIlmu native iPhone slice

SwiftUI owner accounts, adult self-profile selection, explicit sync consent, durable owner/origin/learner-bound progress, and a real shared Kotlin session bridge are implemented. Normal resources contain **zero approved lessons**. This is a simulator development milestone, not a ready learning beta or TestFlight build. Actual authenticated iOS account/profile/sync lifecycle remains unverified while mail is forbidden.

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
AYAILMU_QA_CA_PEM=/path/to/authorized/public/root.crt \
AYAILMU_EVIDENCE_DIR=/tmp/ayailmu-normal-artifact \
ios/scripts/build-private-qa.sh
```

SwiftPM sandboxing stays enabled. Use the reviewed execution path if the outer workspace sandbox denies macOS `sandbox-exec`; do not disable SwiftPM sandboxing. The native XCTest target requires the actual shared framework and app host; it cannot silently skip the golden comparison. Native tests use only fixtures in test targets. Use `/tmp` derived data for native testing here: Documents-based XCTest artifacts stalled during dependent-bundle loading. The native test target's framework search/link settings must point to the built shared framework, with `REQUIRE_SHARED_CORE` set. Run with an explicit dedicated simulator destination and parallel simulator testing disabled.

Dedicated simulator: `8568898D-1CF8-4B81-8CF9-3CC764D517CD`. Never use generic `booted` commands; another app's simulator is protected. Debug bundle identifier: `id.petalytix.ayailmu.ios.privateqa`. Build/test jobs are limited to2. The normal artifact must be rebuilt in separate clean derived data after hosted tests; it must contain no test plugins, fixtures, or test manifest.

The private QA script validates the public CA's exact DER fingerprint before supplying it to the Debug app. Only `DEBUG && PRIVATE_OWNER_QA` can trust it, only for TLS localhost:58443 with hostname validation. No ATS exception or OS trust change is used. Release rejects private QA flags/CA and fails without explicit approved origin, declaration, sync policy and registry-source configuration. No public origin is invented. `--no-mail-tls-probe` is Debug-only process instrumentation: health200, unauthenticated user401, cleartext/wrong-host rejection, plus an actual shared-factory availability receipt. It submits no account/mail requests.

Sessions use app/origin-namespaced Keychain storage. The network capability requires verified provider identity and backend owner. An explicit offline restore can read a previously verified saved identity and local history, but grants no network capability. Successful logout deletes that durable source and fences old capabilities. Backend expiry invalidates the network capability; Restore session or password reauthentication obtains a newly verified one. Local logout and provider revocation outcomes are reported separately.

SQLite lives under app Application Support, excluded from backup, with device file protection where supported. It contains no tokens/passwords/email. Raw immutable Kotlin event payloads, eligibility/outbox acknowledgements, pull cursor and opaque shared session state commit atomically. Retry preserves event bytes/IDs; restart resumes the exact snapshot. Consent opt-out is saved immediately even during an in-flight action; pending withdrawals are flushed for the current owner before further grants/uploads. Pre-consent answers never backfill automatically. Malformed receipts/pages or identity/provenance conflicts stop sync without a success claim.

The verified-resource loader filters approved nonsynthetic adult content, verifies catalog/source and pack/rules hashes, and exposes supported units only. Renderers support choice/true-false, numeric input, estimate slider, pairs, tiles/fill-blank/order, info cards, mini-readings, approved introduction screens and shared feedback. Daily puzzles remain excluded from event sessions; their separate practice UI and advanced activity renderers are not implemented. No `ApprovedLearning.json` or curriculum pack is included in the normal app. Tests' approval fields are fixture inputs, not curriculum approval.

Current local evidence is outside source under `.runtime/umar-ios-learning-m2` in the parent workspace. The result matrix distinguishes portable tests, actual JVM/native golden parity, simulator-only TLS, and unavailable real-auth/approved-content/device-distribution verification. The unsigned ARM64 device framework also compiles/links against the existing iPhoneOS27.1 SDK. Physical phone app/signing/runtime validation, production infrastructure, approved starter content and live authenticated learning remain separate work.
