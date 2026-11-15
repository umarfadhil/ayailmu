# AyaIlmu store release status (2026-11-15)

Local preparation only. Nothing was uploaded, signed for distribution, registered or deployed.
Source: branch `ux/ayailmu-copy-and-design` on top of `c103717`.

## What builds today

| Build | Result | Notes |
|---|---|---|
| Android `:app:bundleProdRelease` | **Built**, 9.5 MB `app/build/outputs/bundle/prodRelease/app-prod-release.aab` | Unsigned. Default prod: `id.petalytix.ayailmu`, 0.1.0 (1), target SDK 36, local-only (no account, no sync, no billing). |
| Android `:app:assembleProdRelease` | **Built**, 6.0 MB `app-prod-release-unsigned.apk` | Minified, lint-vital passed. Never run on a device or emulator (none on this Mac). |
| Android `:app:bundlePublicReleaseCandidate` (account-enabled) | **Not built** | Needs the 11 values in `android/config/public-release-inputs.example.properties`; none exist yet. |
| iOS unsigned Release archive, device arm64, account-free | **Archive succeeded**, 5.1 MB app | No input values passed: the iOS counterpart of the local-only Android build. Lessons open on a device profile; no sign-in is shown and nothing is sent. |
| iOS Release, simulator, account-free | **Built and launched** | Opens on "Choose a lesson language to start" with no sign-in. Tapping through was not possible here (simulator input needs `xcode-select`); the same path is covered by the native test below. |
| iOS native app-hosted tests (simulator) | **51 run, 0 failed** | Includes an end-to-end test (device profile, the real Indonesian maths unit, real Kotlin core, answers kept across a restart) and a test that renders the real lesson screen at every step kind (`TEST_RUNNER_AYAILMU_SNAPSHOT_DIR=<dir>` writes the PNGs). |
| iOS signed archive / IPA | **Not possible yet** | No team and no distribution identity. The app icon now exists; a backend is not needed for a first build. |

## Android upload key and signed outputs (2026-11-15)

Created at the owner's request. The keystore and its password file are outside the repo, in
`~/.aya-secrets/ilmu/android/` (`upload.jks`, `upload.pass`, owner-only). Back both up; they are not
recoverable from anywhere else.

- Alias `upload`, RSA 4096, SHA256withRSA, `CN=AyaIlmu upload key`, valid 2026-11-15 to 2056-11-07.
- Certificate SHA-256: `AA:E1:52:39:64:C8:9B:57:BC:AD:E5:68:1B:3E:08:FB:18:D7:77:D2:E2:DB:DB:F8:E9:75:09:94:7B:8E:2D:F5`
- Certificate SHA-1: `53:25:C9:4E:2C:58:75:1E:3F:71:59:34:4B:DF:E4:62:11:67:AF:79`
- `~/Desktop/AyaIlmu-release/AyaIlmu-0.1.0-1-prod-local.apk`: zipaligned, `apksigner verify` passes
  (v2 and v3; v1 is not applied because minSdk is 26).
- `~/Desktop/AyaIlmu-release/AyaIlmu-0.1.0-1-prod-local.aab`: `jarsigner -verify` reports "jar verified".
- Both are the local-only prod build (no account, sync or billing switched on). The manifest still
  declares INTERNET and BILLING permissions because the prod flavour carries the account and billing code.
- Not installed or run on any device.
- Re-signed on 2026-11-15 after the app icon change, with the same key (certificate SHA-256 unchanged).

## iOS now works without an account, like Android (2026-11-15)

- The core has a device-only owner (`OwnerSession(deviceRegistrySourceCommit:)`). Profiles made with it are
  stored on the device under their own namespace, never sent anywhere, and cannot sync.
- The app opens on lessons. "Account & sync" is an optional, collapsed section, shown only in builds that
  have an approved origin. Without one (the default Release), the app has no sign-in at all.
- When signed in, the account's profiles are shown; device profiles stay on the device and come back after
  sign-out. Device progress is not moved into an account; that would be a separate feature.
- `validate-build-config.sh` now accepts a Release with no origin, declaration or sync policy, but rejects
  any partial account configuration. The registry source commit is still required and now defaults to the
  bundled content's commit (`b6e0d61…`). An account build must use the same commit, or the bundled lessons
  will not load.
- Still adult-only on iOS: there are no child profiles or guardian flow, unlike Android. The shipped content
  is adult-only on both.

## App icon and lesson screens (2026-11-15)

- One drawing for both platforms: Aya waving in front of an ochre sun, on paper. Android uses it as the adaptive
  icon foreground (no inset; Aya sits in the 66 dp safe zone) with the existing one-colour themed layer; iOS uses a
  1024 px PNG of it. Seen on the simulator home screen. Like all of Claude's draft art, it needs the owner's
  approval before it ships (ART_DIRECTION section 7).
- iOS lesson screen: progress bar (as Android), intro and reading cards, full-width answer buttons, a clearer
  answer area for tiles with a Clear button, match pairs as a list of rows, one prominent Check button,
  "I don't know yet" as a quiet link. Rendered and checked at every step kind of the real Indonesian unit.
- The Android session screen already had these (progress bar, drag boards); not changed.

## Fixed in this pass (iOS)

1. The Release configuration did not link the Kotlin learning core at all, so a Release app would have
   shipped with lessons permanently unavailable. Release now requires and links it
   (`REQUIRE_SHARED_CORE`, `SharedLearningCore/build/bin/<target>/releaseFramework`) and fails if missing.
2. `scripts/build-shared-core.sh` now also links the release frameworks. Run on 2026-11-15: JVM tests and all
   four frameworks (debug and release, simulator and device) built, `BUILD SUCCESSFUL`.
3. Added `AyaIlmu/PrivacyInfo.xcprivacy` (no tracking; system boot time reason 35F9.1 for answer timing;
   email, user ID, product interaction and other user content, linked, app functionality). The collected-data
   list follows `data_safety.md` and needs the same review as the store answers.
4. iPad orientations: all four declared for iPad, which upload validation requires for an iPad-capable app.
5. `ios/config/release-inputs.example.xcconfig`: the short list of iOS values, passed with `-xcconfig`.
   Checked that an xcconfig passed this way overrides the project values.

## Blockers, in the order they must be cleared

### Play internal testing (local-only build: nearest target)
1. Play Console developer account and an app entry. The package name is permanent from the first upload.
2. An upload key (a keystore only you create and keep) and acceptance of Play App Signing.
   The release build type has no signing config; sign the built AAB with
   `jarsigner -keystore <your.jks> app-prod-release.aab <alias>`, or decide to add a property-driven
   signing config to `app/build.gradle.kts`.
3. Run the release build on at least one real phone. It has only been compiled and rendered in tests.
4. Console forms needed even for internal testing to be useful later: privacy policy URL, data safety,
   content rating, target audience. Internal testing itself accepts an upload before these are complete.

### Play, account-enabled build
5. Backend deployed (hosting plan), then the inputs file: origin, production declaration and sync-policy
   IDs, registry source commit, Play licensing public key, privacy policy URL, support URL, account
   deletion URL. A `workers.dev` origin passes the gate's host rules.
6. A reachable web account-deletion page. Play requires it for any app that lets people create accounts.

### TestFlight
1. Accept the App Store Connect invitation; the role must allow uploads and certificate access
   (App Manager or Admin, or Developer with "Access to Certificates, Identifiers & Profiles").
2. Decide the bundle ID, register it, create the app record. Fill `DEVELOPMENT_TEAM`.
3. No longer a blocker for a first build: the account-free Release needs no backend. The five
   `AYAILMU_*` values are only for a later account-enabled build.
4. Done locally: Kotlin/Native 2.2.20 (Maven Central, SHA-1 `e5d2f65c8bbce4dadef4b8da53a6cc62c9c8dd4e` verified)
   and its LLVM/libffi dependencies are in `ayailmu-unified-source/ios-toolchain/` (1.4 GB+, outside the
   checkout). Rebuild the core with `scripts/build-shared-core.sh` after any change to the Android
   model/content/engine sources it is derived from.
5. App icon: done, awaiting the owner's approval. `AyaIlmu/Assets.xcassets/AppIcon.appiconset` holds a 1024 px
   opaque icon (Aya waving in front of an ochre sun), written by `art/tools/ios_icon.py` from the same drawing as
   the Android adaptive icon (`art_app_icon`, key `app_icon` in `art/tools/draw.py`).
6. Export compliance answer (the app uses only HTTPS and Apple's CryptoKit hashing); either answer in
   App Store Connect per build or add `ITSAppUsesNonExemptEncryption` to Info.plist.
7. Archive with automatic signing in Xcode 27.1 and upload. First real run on a physical iPhone is also
   still outstanding.

## Store requirements beyond the binary

- **Privacy policy URL**: `privacy_policy.md` is a working draft with open blockers (legal operator and
  address, contact mailbox, processors and countries). Needed for Play listing, App Store review and
  TestFlight external testers; not for TestFlight internal testers.
- **Account deletion**: in-app deletion exists in source on both platforms but has not been accepted
  end to end against a deployed backend; the hosting plan still lists the erasure route as your decision.
- **Data safety / privacy labels**: `data_safety.md` says "not submission-ready". For the local-only
  builds on both platforms the honest answer is close to "no data collected"; for the account-enabled
  builds it is email, user IDs, app activity and typed answers. `PrivacyInfo.xcprivacy` lists the account-enabled
  data types and is shared by both builds, so it stays as it is: listing types an account-free build does not
  collect is harmless, while an emptied list would be wrong for the account build. What users see is the App Store
  Connect privacy label, which should say "Data Not Collected" for the account-free release.
- **Age rating / audience**: the shipped content is one adult maths unit, but the Android app still has
  child profiles and a guardian flow. Declaring children in the target audience brings the Families
  policy and (on Apple) Kids-category rules. Simplest consistent choice for a first release: adults
  only, listing text that promises one maths unit and says more is coming, no "for kids" wording.
- **Screenshots**: none exist for store use. Android phone screenshots need a device or emulator;
  iOS needs 6.9-inch iPhone and 13-inch iPad sets (or drop iPad from the device family).
- **Listing vs content**: `docs/BUILD_PLAN.md` describes several subjects and kids packs; prod ships
  only the reviewed adult maths unit. The listing must describe what is in the build.

## Notes

- The earlier local iOS identifier `id.petalytix.ayailmu.ios.local20261103` and the development
  provisioning profiles that expire on 17 November 2026 only matter for installing debug builds on your
  own devices. TestFlight uses a distribution profile that Xcode creates once the team is set.
- Proposed, not chosen: Android `id.petalytix.ayailmu`, iOS `id.petalytix.ayailmu.ios` (both already
  the source defaults), version 0.1.0 build 1. Using `id.petalytix.*` assumes you control petalytix.id.
