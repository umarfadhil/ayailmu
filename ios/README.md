# AyaIlmu iPhone account milestone

Native SwiftUI account flows and a dependency-free Swift package. No lessons are bundled. Shared Kotlin learning-core integration, learner persistence, progress and lesson rendering are subsequent milestones; this is not a usable learning beta or a TestFlight build.

Use Xcode 27.1 without changing global xcode-select:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.app/Contents/Developer \
CLANG_MODULE_CACHE_PATH=/tmp/ayailmu-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/ayailmu-swift-cache \
swift test --package-path ios/AyaIlmuCore --jobs 2
python3 -I -B -m unittest discover -s ios/tests -p 'test_*.py'
AYAILMU_QA_CA_PEM=/path/to/authorized/public/root.crt ios/scripts/build-private-qa.sh
```

SwiftPM sandboxing stays enabled. In a restricted outer workspace sandbox, use the reviewed command execution path if macOS denies `sandbox-exec`; do not disable SwiftPM sandboxing.

The private QA script validates the exact public CA DER fingerprint before supplying it to the Debug app bundle. No CA or credentials are committed. Only `DEBUG && PRIVATE_OWNER_QA` can evaluate this CA, and only for TLS localhost:58443 with hostname validation. Release uses system TLS and fails its build until explicit approved non-loopback HTTPS origin and declaration inputs are supplied. PRIVATE_OWNER_QA or a private CA in Release is rejected. Production configuration requires a separate verified infrastructure handoff. The Debug bundle identifier has the `.privateqa` suffix.

Dedicated simulator: `8568898D-1CF8-4B81-8CF9-3CC764D517CD`. Never use generic `booted` commands: another app's simulator is protected. `--no-mail-tls-probe` is Debug-only process instrumentation for health 200, unauthenticated user 401, cleartext rejection and wrong-host rejection. It writes only status evidence to the app Documents directory; it has no credential, mail, or account action.

Sessions are stored only in this app's origin-namespaced Keychain item, accessible when unlocked on this device. Installation requires confirmed provider identity and owner activation; restore refreshes only HTTP401 or403 with structured `bad_jwt`, then checks the stored provider subject/email and backend owner. Generation fencing prevents late operations installing after logout/cancel. Local logout reports server revocation separately. Real email/native authenticated lifecycle remains unverified while mail is forbidden. Unit fixtures exist only in the test target.

The current UI is English. Indonesian UI localization, real-session Keychain verification, shared-core learning, account-bound learner/progress persistence, reviewed lessons and physical-device acceptance are still required before a usable learning beta. Simulator compilation and four no-mail transport checks do not prove those flows. Apple signing/team ownership and a verified remote origin remain separate operator inputs; no login, provisioning or TestFlight action is included.
