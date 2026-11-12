# Explicit Android public-release inputs

12 November 2026. Local configuration preparation only. This is not permission to deploy, create credentials, sign, publish, or use real accounts for testing.

## Why this gate exists

The ordinary `prod` variant filters reviewed content but historically allowed unsigned CI candidates with Auth off, an empty origin and billing off. That remains useful for local compilation and regression checks, but must not be described as the requested public full-feature release. Existing CI labels its artifact unsigned and unapproved.

New `checkPublicReleaseInputs`, `assemblePublicReleaseCandidate` and `bundlePublicReleaseCandidate` tasks refuse absent or invalid explicit inputs. Supplying a public input file also validates it before any Java configuration generation, and makes `preProdReleaseBuild` depend on the check. Candidate aliases order the check before production build/configuration and packaging. They do not sign, install, contact an endpoint or publish. Direct ordinary `assembleProdRelease`/`bundleProdRelease` without the file remains the existing **unapproved, potentially offline-only CI build**, not a public-release route.

## Input contract

Copy `android/config/public-release-inputs.example.properties` outside the checkout. The example deliberately contains no chosen identity/domain/version/key. Fill every field only with selected, approved release facts:

- Format version 1; explicit Android application ID, semantic version and positive Play version code. Development/demo/lab/owner-beta identities and prerelease version labels are refused. Store ownership and monotonic version history are not verified offline.
- Durable canonical HTTPS API/Auth origin, without path, port, userinfo, query or fragment. Local/IP/documentation/temporary tunnel origins are refused. This performs no DNS or TLS request, so accepted syntax does not prove routing, ownership or publicly trusted TLS.
- Actual owner declaration and sync-policy versions and a nonzero 40-character registry source commit. QA/test/demo placeholders are refused. This does not approve those policies or prove the commit is deployed.
- Existing Play licensing **public** RSA X.509 key, at least 2048 bits. This is not a signing key, password, token or payment credential. The gate does not generate or retrieve any key and cannot verify Play ownership.
- Public privacy-policy, support and account-deletion URLs. These are declared release metadata in the plan, not published pages or a claim that the app already links them. Actual reachability, policy content, in-app linking, web deletion processing and legal acceptance remain release gates.

The parser accepts only the exact fields in the blank template, one canonical `key=value` entry per field. Duplicate/unknown/missing/blank fields, escapes, multiline values, oversized files and symlink inputs are refused. It never prints rejected values. Conflicting legacy build properties and simultaneous private QA/owner build opt-ins are refused rather than silently overridden. Avoid saving the completed file or public key in version control.

## Offline validation and local candidate preparation

Use an explicitly selected file:

```sh
cd android
sh gradlew :app:checkPublicReleaseInputs \
  -Payailmu.publicRelease.inputs=/absolute/path/to/selected-public-inputs.properties
```

The check writes `app/build/reports/public-release/configuration-plan.json`. It always says `launch_ready: false`, records a canonical input-values fingerprint and public-key fingerprint, and lists unverified gates. It does not include the public key itself. A failed later invocation does not make an older report evidence for new inputs; check the fingerprint and successful invocation together.

When local artifact preparation is appropriate, the same explicit file is required by `:app:assemblePublicReleaseCandidate` or `:app:bundlePublicReleaseCandidate`. The selected inputs affect **prod only**: application ID/version, normal Auth and matching required origin, declaration/policy/registry, and billing/public licensing key. Demo, syncLab, normalQa and ownerRemote are not retargeted by this file. Normal prod has no demo, synthetic lab or owner-sign-in-only flag.

No actual release identity/domain/key was chosen in implementing this gate. Positive tests use public-only fixture material solely to inspect generated Java configuration; they never install or run that app, contact those domains, create an account, or build/publish a fixture-identified release artifact.

## Verification and limits

`android/tools/test_public_release_configuration.py` exercises the real offline Gradle parser, missing-input aliases, production BuildConfig, demo isolation, origin/identity/version/policy/public-key constraints, input injection, unknown/duplicate fields, conflicts and file bounds. Run with the isolated Gradle cache used for this checkout. Final results and audit evidence are under the Mac's `2026-11-12/ayailmu-release-integration` directory.

The gate does **not** replace curriculum approval, full feature testing, real Auth/mail/provider/device acceptance, Play purchases/restore/refunds, signing/store identity, release source integration, public web deletion, retention/backups, or policy approval. The current reviewed production payload remains one adult Mathematics unit with 14 questions; the full requested scope has not been reduced to that slice. Existing-install identity/data migration must be deliberately reviewed before selecting a different application ID or origin.
