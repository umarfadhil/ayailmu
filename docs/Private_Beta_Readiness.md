# Private-Beta Readiness Checklist

**Current status (reconciled 2026-10-17 for the merged native + Expo repository):** **not ready for a private learner beta on any platform.** The Expo prototype is suitable only for continued synthetic developer QA.

This checklist authorizes nothing: no accounts, credentials, signing, agreements, licences, payments, submissions, installs, builds, tunnels, store or deployment steps, pushes, or broad features. It states no current store, account or policy rule as fact.

## Where things stand (2026-10-17)

- **Product direction (owner, recorded 2026-10-17):** a Kotlin Android app and a Swift iOS app at launch ([`../ai-memory/PROJECT_OVERVIEW.md`](../ai-memory/PROJECT_OVERVIEW.md)). The Expo app in `prototype-expo/` is the reference prototype, not a release product. Its builds count toward neither a launch nor a learner beta.
- **Android (Kotlin, `android/`):** source exists. Phase stamps are in PROJECT_OVERVIEW §Milestones: P0 device-tested on one phone, P1–P2 compiled, P3a/P3b in source only. No green run of the CR-REL-2 gate is recorded, and the P3 device gate is pending. This integration left main's Android source and reports unchanged and did no Android build, test or device run.
- **iOS (Swift):** not implemented. There is no source, Xcode project, signing, build or device evidence. There is no iOS plan either: `docs/BUILD_PLAN.md` covers Android only.
- **Expo reference prototype:** on the integration tree, 23 Jest suites / 381 tests pass, as do TypeScript and Expo lint. They ran on Node 22.16.0 with existing dependencies; nothing was installed. Known warnings: Expo Router multiple-linking and Node experimental SQLite. No export, browser or rendered QA, or native run was done for this integration. None of this is native-release evidence.
- **Backend:** this branch has no backend implementation. A separate local Go/PostgreSQL/Firebase workstream is approved; see PROJECT_OVERVIEW. That approval supplies no backend readiness evidence here.
- **Content:** no pack in the repository is approved.
  - The prototype's active pack `demo-synthetic-0.3` (45 items, 8 screens, all draft) is synthetic, unreviewed and recognition-only. Tester mode refuses it and shows no lessons.
  - Android's packs are synthetic drafts too: `demo-synthetic-0.1` (Arabic, typed and binary choice) and `mat-sample-0.2` (math). Going by the gating code, a `prod` build would therefore show no learning content; no `prod` build has been checked.
- **Evidence limits:** four-choice answers are recorded as recognition only. The replacement "learned" (mastery) rule is unresolved, so mastery, retention and transfer stay unassessed. VRB-02 and speech items stay locked.

## Native product gates (each platform separately; none is met)

A pass on one platform proves nothing for the other. Browser QA, Jest results and Expo JavaScript exports satisfy none of these gates.

- [ ] **Learning loop in native source.**
  - Android has the P3a/P3b loop in source. Its Arabic track runs the typed v0.1 demo pack, not the four-choice loop.
  - `android/core/engine/PARITY.md` maps only the prototype's original five suites. The latest four-choice Arabic contract in the v0.3 reference has not been ported, and native parity is not established. This does not prescribe question types for future subjects or cohorts.
  - iOS: nothing yet.
- [ ] **Automated gate green and recorded.** Android: CR-REL-2 (`ai-memory/CODE_RULES.md`). iOS: no gate is defined.
- [ ] **Arabic display.** Android still uses a placeholder serif font (`android/core/design/src/main/java/id/petalytix/ayailmu/core/design/theme/AyaType.kt`); Noto Naskh Arabic is not bundled yet (CR-ENG-6). iOS: nothing yet.
- [ ] **Signed build of the release app.** Android: no release signing configuration is in the repository (CR-REL-5). iOS: none.
- [ ] **Physical-device QA recorded per platform**, using the checklist below.
- [ ] **Beta distribution route.** This is the owner's choice, per platform. Which accounts, programmes and store rules apply must be verified when the route is chosen; this document asserts none of them.
- [ ] **Approved content only.** Every item needs reviewer approval and must ship in an approved pack. Check that `prod` and tester builds show nothing else.
- [ ] **Privacy and consent.** The consent text is a draft awaiting UU PDP review, and the support mailbox must exist before the closed test (PROJECT_OVERVIEW). Whatever method collects beta evidence must match the consent text; that method is the owner's decision.
- [ ] **iOS counterparts of the Android/Play-specific decisions:** distribution, purchases, crash data, the kids/Families posture and share-sheet export. Not decided (PROJECT_OVERVIEW).

**Physical-device QA checklist.** Run it on each native app's own build, and record the device model, OS version and build for every run. Each item applies to the flows a native app implements. A missing flow is a gap, not a pass.
- [ ] Harakat and right-to-left Arabic at every Arabic size setting, also with the system's larger text on.
- [ ] Touch targets, and focus order with a keyboard where the platform supports one.
- [ ] After a correct, wrong, «belum tahu» and timed-check answer, the whole result and Lanjut come into view without animation. Feedback taller than the screen starts at its heading. After Lanjut, the next question starts at its heading.
- [ ] Safe areas (notch, home indicator, navigation bar) and the Android Back button.
- [ ] Saving, force-quit and restart, background and resume, including the session clock.
- [ ] Delayed-check concealment during a check, in the summary and on the progress screen.
- [ ] VoiceOver on iPhone and TalkBack on Android: focus moves and announcements.
- [ ] Reduced motion: Reduce Motion on iOS and the remove-animations setting on Android.
- [ ] Android also: one low-end phone (≤ 3 GB RAM) and one tablet (CR-REL-2, DEVICE-TESTED).

## Expo reference prototype: still open

These items keep the reference honest. None is a launch gate.
- [ ] **Premium-feel fixes.** The top 3 changes in `Premium_Feel_Audit.md` are implemented. Jest covers their logic and copy, but not the rendered scroll of fix 1.
  - Still open: rendered browser QA of the current build (confirm the preview serves `demo-synthetic-0.3`), and an Indonesian reviewer's check of the new wording.
  - The fixes exist only in the prototype. Nothing has been ported to Android, and iOS has no UI.
- [ ] **Two other audit findings.** Turn off the fades under reduced motion (`prototype-expo/src/ui/Nav.tsx`, report modal in `prototype-expo/src/ui/components.tsx`). Fix the blank white launch screen: `prototype-expo/src/app/_layout.tsx` renders nothing until fonts load.
- [ ] **Coverage gaps.**
  - VRB-01 has no READY or D7 item and only one D30 item.
  - The MT-B2/VT1 and MT-B3/VT2 clashes are unresolved.
  - Not built: the entry check and audio, mini readings, background questions, survey and reminders.

## Open decisions (owner)

Still open from the 2026-10-16 list below:
1. Question format.
2. The "learned" rule.
3. Beta evidence.
4. Review of the three UI fixes and their wording.
5. Reviewers, app name and icon. The native consent/deletion contact is decided in PROJECT_OVERVIEW; the prototype still shows «belum ditetapkan».

Items 6–8 there concern Expo Go and Expo builds, so they now apply to the reference prototype only.

Added by the merge:
- the unported four-choice Arabic contract and unestablished native parity (implementation gaps, separate from the existing seven-item question-format decision);
- how the Swift iOS app is built and structured (nothing is decided here);
- the iOS counterparts of the Play-specific decisions.

## Historical: 2026-10-16 (UTC) Expo-snapshot checklist

> Kept as written on 2026-10-16, apart from heading levels. It was written for the Expo prototype on `feature/four-choice-learning-loop`. At that time the prototype lived in `app/` and that branch had no `android/` folder.
>
> Everything below describes that Expo snapshot only. That includes "this app", the machine inventory, the missing native folders, EAS and build-setup items, the Expo guides and the distribution notes. None of it describes the Kotlin Android app now in `android/` or the planned Swift iOS app.
>
> Its account and store statements were unverified then and are not re-checked here. The evidence folder it cites (`.design-reference/premium-audit-20261016/`) is git-ignored and is not part of this repository.

Date: 2026-10-16 (UTC), including the same-day update for Amar's requirement of first-day support on both iPhone and Android. Status: **not ready for a private learner beta.** Suitable only for continued synthetic developer QA.

This checklist authorizes nothing: no accounts, credentials, signing, agreements, licences, payments, submissions, installs, builds, tunnels, store or deployment steps, pushes, or broad features. The user has deferred the personal phone preview. The original audit was read-only: it left previews, code, settings and source untouched. That describes the audit only, not the later implementation of the approved UI fixes.

Sources: `current-readiness-inventory.json`, `final-independent-review.json`, `repair-result.json`, `final-preservation-check.json` and the local browser evidence, all in the git-ignored folder `.design-reference/premium-audit-20261016/`. The 2026-10-16 (UTC) machine inventory below is Codex's read-only check: nothing was installed, accepted or changed.

### Established (developer prototype only)
- [x] 22 test suites (366 tests), typecheck and lint passed on the pinned repair snapshot (repair-result.json). Not re-run for this audit.
- [x] Independent repair review: 0 Critical, 0 Important.
- [x] Fresh isolated browser QA (:8084, v0.3): no page or console errors, no overflow at 320, 390 or 1440 px.
- [x] Web, iOS and Android **JavaScript exports** exist in both modes. Neither the Expo web preview nor these exports count as native builds or native-release validation.
- [x] Tester mode rejects the unapproved content pack and shows only the empty state.
- [x] No literal blanks: the active pack has 0 literal-blank items (verified).

### Open before a learner beta
- [ ] **iPhone and Android from day one (owner requirement).** The first beta and the launch must support both iOS and Android. Each platform needs its own signed build, its own native QA evidence and its own beta-distribution gate; a pass on one platform proves nothing for the other. Whether builds are made locally or in the cloud is a separate choice. See "First-day iPhone and Android" below.
- [ ] **Apple Developer Program membership: UNCONFIRMED.** Not inspected. TestFlight needs it.
- [ ] **Google Play Console account: UNCONFIRMED.** Not inspected. Needed only if Play internal testing is chosen; a signed internal APK does not itself need one.
- [ ] **Native success: UNCONFIRMED by this work on both platforms.** This work has not confirmed any device, simulator or emulator run. The local simulator and emulator setup on this machine is incomplete (see the inventory below).
- [ ] **Standalone build setup is absent for both platforms:** no `eas.json`, expo-dev-client, EAS project, iOS bundle ID, Android package or native project folders, and no EAS CLI on this machine. There is no project signing configuration; machine and account credentials were deliberately not inventoried. An Expo Go preview needs none of this. None of it is authorized.
- [ ] **Question format: decision pending.** Keep the 7 full-sentence form-selection items, or replace them with meaning/comprehension questions. No change authorized.
- [ ] **Linguistic approval:** all 45 items and 8 screens are synthetic drafts. No qualified Arabic or Indonesian reviewer has approved them, so a tester build shows no lessons.
- [ ] **Coverage gaps:**
  - In Unit B, the VRB-01 skill has no READY or D7 items and only one D30 item.
  - Not built: entry check and audio, mini readings, background questions, survey, reminders.
  - The MT-B2/VT1 and MT-B3/VT2 clashes are unresolved.
- [ ] **Evidence limits:** D7/D30 checks record raw delayed four-choice recognition results; keep that evidence. They support no validated mastery, transfer or learning-efficacy claim, and sparse checks support no pass claim. The “learned” rule is pending; VRB-02 and speech items stay locked.
- [ ] **Beta evidence collection: owner decision.** No reviewed collection workflow exists, and answers stay on the device. Consented observation, interviews or manual collection may be possible. The consent text currently says data stays on the device, so it must match whatever method is chosen. No feature is authorized.
- [ ] **To verify later:** the current beta, store and privacy requirements for this account are not established here and are not stated as fact. App facts: the deletion contact shows “belum ditetapkan”, and the name “Arabic Trial (Prototype)” and the Expo template icons are placeholders.

### First-day iPhone and Android
**Required on each platform, whatever the tooling:** a signed standalone build of this app, native QA evidence from a physical phone, and a beta-distribution route. Making builds locally (Xcode, Android Studio) or in the cloud (EAS Build) is a separate choice; neither is authorized now.

**Machine inventory (read-only, Codex, 2026-10-16 UTC):**
- **iOS:** Xcode.app is present, but the active developer directory is `/Library/Developer/CommandLineTools`. With `DEVELOPER_DIR` pointed at Xcode only for these read-only checks, `xcodebuild -checkFirstLaunchStatus` exits 69 (Xcode's first-launch steps are not complete) and `simctl list runtimes` lists no runtimes.
- **Android:** no Android Studio in `/Applications` or `~/Applications`, no `~/Library/Android/sdk`, `ANDROID_HOME` and `ANDROID_SDK_ROOT` unset, and no `adb`, `emulator`, `sdkmanager` or `avdmanager` on the PATH.
- **Shared:** JDK 17.0.12 is installed (alongside 22 and 11), so no other JDK is needed now. Node 22.16 is installed. There is no EAS CLI, `eas.json`, `ios/` or `android/` folder.

**Proposed local setup (optional; a separate step, not done and not authorized):** this gives simulators, emulators and local builds. It is not required for EAS cloud builds, or for installing and testing cloud-built apps on physical phones.
1. **iOS:** Amar completes Xcode's first-launch and licence steps. Then select Xcode as the active developer directory and add an iOS Simulator runtime that matches the project's Expo SDK. Guide: https://docs.expo.dev/workflow/ios-simulator/
2. **Android:** install Android Studio; add the SDK platform, platform tools and build tools that the project's Expo SDK requires; create an ARM (arm64) emulator; use the installed JDK 17. Guide: https://docs.expo.dev/workflow/android-studio-emulator/
3. Take every version from the project's Expo SDK at setup time. This checklist pins no Xcode, iOS runtime, Android API level or build-tools version.

Simulators and emulators help development. They do not replace the physical-device gate below.

**Native QA gate, run separately for each platform:** test this app's own standalone build on at least one physical iPhone and one physical Android phone, including a small screen, and record the device model, OS version and build for every run. Expo Go on the same phones can give early native interaction evidence for these items, but it does not validate the standalone or release build.
- [ ] Harakat and right-to-left Arabic at all three Arabic sizes, also with the system's larger text on.
- [ ] Touch targets, and focus order with a keyboard where the platform supports one.
- [ ] After a correct, wrong, «belum tahu» and timed-check answer, the whole result and Lanjut come into view without animation. Feedback taller than the screen starts at its heading. After Lanjut, the next question starts at its heading.
- [ ] Safe areas (notch, home indicator, navigation bar) and the Android Back button.
- [ ] Saving, force-quit and restart, background and resume, including the session clock.
- [ ] Delayed-check concealment during a check, in the summary and on Kemajuan.
- [ ] VoiceOver on iPhone and TalkBack on Android: focus moves and announcements.
- [ ] Reduced motion: Reduce Motion on iOS and the remove-animations setting on Android.

Browser QA and JavaScript exports do not satisfy this gate on either platform.

**Beta distribution gates (choices for later, not authorization):**
- **iOS:** TestFlight. Needs confirmed Apple Developer Program membership, a bundle ID, signing and a standalone build.
- **Android:** either a signed APK shared through internal distribution (https://docs.expo.dev/build/internal-distribution/), which does not itself need a Google Play account, or Play internal testing, which needs a Google Play Console account.
- On either platform, whether an Expo (EAS) account is needed depends on the build route chosen.
- Nothing here claims store eligibility. No store publication, account enrollment, licences, builds or tunnels now.

### Quality before any tester sees it
- [ ] The top 3 changes in Premium_Feel_Audit.md, already approved by Amar and now implemented: review the results after fresh tests and browser QA, and have the Indonesian reviewer check the wording.
- [ ] Turn off the fades under reduced motion; fix the blank white launch screen.
- [ ] On a physical iPhone and a physical Android phone, check that harakat render correctly at all three Arabic sizes (part of the native QA gate).
- [ ] After any fix, re-run isolated browser QA and confirm the preview serves the current content version.

### Decisions for Amar
1. Question format: keep the 7 form-selection items, or replace them with meaning/comprehension questions.
2. A replacement rule for “learned”, or keep it unassessed.
3. Beta evidence: how to collect it, and how much.
4. Review the results of the three already-approved UI fixes and their Indonesian wording.
5. Reviewers, app name and icon, privacy and deletion contact.
6. When the deferred Expo Go preview can run.
7. Build tooling for each platform: the optional local setup, cloud builds, or both, and when. Xcode's first-launch and licence steps are Amar's to accept.
8. The Android beta route: a signed internal APK or Play internal testing. iOS uses TestFlight.

### Notes
- :8081 served the stale demo-synthetic-0.2 pack. Before any preview or handoff, confirm which content version is being served. Per the README, stop Metro and clear the cache when switching modes. :8083 was not restarted.
- **Two different phone paths:**
  - *Expo Go physical preview* (deferred until Amar schedules it): runs this app inside the Expo Go app on real phones, with native React Native components. It needs an Expo Go client that matches the project's SDK and possibly a free Expo account, but no Xcode, Android Studio, Apple membership or local build. Whether the app runs in Expo Go is not yet confirmed. It can give early native interaction evidence, but it does not validate this app's own standalone or release build.
  - *This app's own standalone builds* (required for the beta, on both platforms): need project build and signing configuration, a build route (local or cloud) and the distribution gates. Node, JDK 17 and Xcode are installed, but the local native setup is incomplete (Xcode's first-launch steps, an iOS Simulator runtime, Android Studio and its SDK) and the project's build configuration does not exist yet.
- Node 22.16 ran the fresh preview; the shell default is v25.8.0. Use one consistent, supported LTS toolchain, and the installed JDK 17 for any local Android build.
- The Sottaku investigation stays in task 01a14528-d140-7246-9fdd-53d0c21be0de; this checklist does not duplicate it.

### Next practical gate
1. **Amar's decisions** above, including a time for the deferred Expo Go preview if wanted.
2. With Amar's go-ahead, the chosen build tooling for both platforms: the optional local setup, cloud builds, or both.
3. Native QA of this app's own build on a physical iPhone and a physical Android phone, with evidence kept per platform.
4. Later and separately, each platform's beta distribution gate: TestFlight for iOS, which needs Apple Developer Program membership, and the chosen Android route, where only Play internal testing needs a Google Play Console account. Each needs its own signing and build; none is in place or authorized.
