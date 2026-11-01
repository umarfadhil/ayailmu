# Android-first launch and Play key validation implementation plan

Goal: Make AyaIlmu's first-release backlog Android-only and close the unvalidated Play public-key build-input gap without configuring credentials or changing runtime backend behavior.

User direction: Continue implementation, launch AyaIlmu on Android first; no Swift/KMP for this release. Infrastructure is owned by a separate worker. The existing synthetic guardian/child backend stays intact while its canonical direction is pending. No publication, merge, deployment, credential setup or account actions.

Approach: Retain the existing unsigned CI candidate. Validate any supplied Play licensing public key with standard JCA RSA/X.509 parsing before Java generation. Add an explicit `:app:checkPlayLicenseKey` task which requires a usable nonempty key; it is one release prerequisite, not a signing or production-readiness certificate. Keep absent-key demo/unsigned candidate builds available. Supplied malformed input must fail with a sanitized diagnostic and never be interpolated into generated Java.

Files owned exclusively by the Android Kimi worker:
- android/app/build.gradle.kts
- android/tools/test_play_license_configuration.py (new behavioral Gradle-input tests; nearby fixture file if needed)
- docs/store/closed_test_runbook.md
- ai-memory/PROJECT_OVERVIEW.md
- ai-memory/MONETIZATION_SCHEME.md
- docs/BUILD_PLAN.md

Do not edit backend*, integration*, workflows, curriculum/statuses, runtime services, other app source or account/security settings.

1. Inspect actual build and local billing verifier. Write behavioral tests that invoke real offline Gradle configuration/tasks with independent public synthetic fixtures. No source-text assertion tests, no generated signing/private key/credentials. Cover absent key default build, malformed supplied key, Java/line-break payloads, wrong public-key kind, valid RSA public key, and explicit task absent/invalid/valid behavior. Observe baseline failures caused by absent validation; avoid negative tests passing merely because a task is missing.
2. Implement minimal standard-library validation and the explicit key check. Do not change licensing algorithm, billing UI, dependencies, app IDs, versions, defaults, signing configuration or content gates. Do not log raw input. No live Play/key ownership validation is claimed.
3. Update current overview and build backlog: Android first per user2026-10-25; defer all I0–I5/Swift/KMP/TestFlight work out of this release without erasing the historical October22 plan. Apple billing decisions deferred. Backend direction and child consent/retention remain untouched.
4. Update the closed-test runbook with the real key-check command and precise owner inputs. Existing AyaIlmu upload key/store record metadata is unknown; do not generate a replacement or reuse AyaKasir keys.
5. Run focused RED→GREEN tests, then relevant Android native suites and prod lint/unsigned bundle using existing caches. No Go/provider/device reruns or installs. Save command logs/counts/actual exits and model metadata to the private evidence folder. No commit/push.
