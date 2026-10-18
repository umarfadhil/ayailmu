DRAFT 2026-10-17 — written by Claude; needs Umar's review and, for the privacy policy, a legal check against UU No. 27/2022 (UU PDP) before publication.

# Google Play Families self-review — AyaIlmu

This applies because the target audience is mixed: children and adults (PROJECT_OVERVIEW "Play policy posture"). The checklist is based on the Families policies help page as read on 2026-10-17. The old "Designed for Families" programme is now part of the Families policy plus the optional Teacher Approved programme. **Verify every row against the current policy page before submitting.**

Status meanings: **MET** = the code or rule exists (most code is still IN SOURCE, so device checks are still due) · **TO CHECK** = Umar must verify or do something in Play Console · **OPEN** = a decision or gap remains.

| # | Requirement | Status | Evidence | What Umar must do |
|---|---|---|---|---|
| 1 | Target audience declared accurately (App content → Target audience and content) | TO CHECK | PROJECT_OVERVIEW: kids track = readers about 7–12, plus adults | Pick the age groups. Suggested: 6–8 (if 7-year-olds are in scope), 9–12, 13–15, 16–17, 18+. Answer "appeals to children" honestly. [UMAR: choose groups] |
| 2 | No ads; no ad SDK | MET | MONETIZATION_SCHEME "no ads"; no ad SDK in `gradle/libs.versions.toml` | Answer "No ads" in App content |
| 3 | Only SDKs that are approved for child-directed services or do not collect children's data | MET (code) / TO CHECK (build) | CR-DAT-3; libraries are AndroidX, Hilt, Room, DataStore, kotlinx and Play Billing 8 only | Run `./gradlew :app:dependencies --configuration prodReleaseRuntimeClasspath` and check Merged Manifest before each release. Vet Rive (P4) before adding it |
| 4 | Children's identifiers are not transmitted (AAID, SIM or build serial, BSSID, MAC, SSID, IMEI, IMSI); the phone number is not requested | MET | CR-DAT-2; `AndroidManifest.xml` (only POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED; no INTERNET) | Confirm in Merged Manifest that no library adds READ_PHONE_STATE, location or AD_ID |
| 5 | All data from children is disclosed, including data in exports | OPEN | `SettingsViewModel.export` exports `profiles.all()` and `answers.allEvents()`, which includes child profiles | Decide: limit the export to consenting adult trial profiles (recommended), or disclose it (`data_safety.md` J2; privacy policy §3) |
| 6 | Neutral age screen | MET | CR-DAT-5; `OnboardingViewModel` (`OnboardingRules.kindFor`); `strings.xml` `onb_age_*` | Device-test: no year preselected; wording does not hint at a "right" answer; an under-13 on first run is sent to a parent |
| 7 | Child profiles only from an adult; adult-only settings | MET | CR-DAT-5; `SettingsViewModel.requireAdult` (export, delete, reminder) | Device-test both profile kinds |
| 8 | Adult gate before purchases | MET | CR-BIL-5; `StoreViewModel.AdultGate` (arithmetic question); `StoreScreen.HoldToConfirmButton` | Device-test on a child profile; check that the gate shows again after leaving the store |
| 9 | No shocking or emotionally manipulative tactics to drive purchases | MET (rules) / TO CHECK (copy) | CR-HAB-6, CR-HAB-2; MONETIZATION "What paying never buys"; locked units labelled plainly | Read the store and locked-unit copy in both languages: no countdowns, no "only today", no pressure on children |
| 10 | Virtual items are clearly distinguished from real money | MET | CR-BIL-5: Play-formatted prices only, no coins | None |
| 11 | Notifications are not used to pressure children | MET | CR-HAB-5: one optional reminder, off by default, set only by an adult; permission asked only then; calm copy in `strings.xml` `reminder_*` | Device-test on Android 13+ (permission prompt timing) |
| 12 | Content accessible to children is appropriate | TO CHECK | CR-ENG-2 (prod shows only `approved` items); P8 kids packs are unreviewed drafts | Approve every kids pack through the reviewer before release; illustrations pass ART_DIRECTION; the Arabic trial is 18+ (`Consent.MIN_AGE`) |
| 13 | Social features or free text from children | MET | No chat or sharing between users; «Laporkan soal» on child profiles = reasons only, no free text; stored on the device | Device-test the child report dialog |
| 14 | Accurate privacy policy, linked in the store listing | TO CHECK | `docs/store/privacy_policy.md` (draft) | Legal check (UU PDP), publish on petalytix.id, enter the URL in Play Console |
| 15 | In-app link to the privacy policy | OPEN | No privacy link found in `strings.xml` | Recommended: add a "Kebijakan privasi" row in Settings that opens the URL. It needs no INTERNET permission because the browser opens it |
| 16 | Data safety form consistent with the app | TO CHECK | `docs/store/data_safety.md` | Settle J1–J5, then submit |
| 17 | Compliance with applicable laws (COPPA, GDPR, local law) | TO CHECK | No data is transmitted by the app | Choose distribution countries [UMAR]. If outside Indonesia, check those laws too. UU PDP: legal check |
| 18 | Deletion is easy for a parent | OPEN | Only «Hapus semua data» removes a child profile; `deleteProfile` deletes the active adult's own profile | Recommended: let an adult delete one child profile |
| 19 | Billing Library version | MET | `billing = "8.0.0"`; CR-BIL-1 | Keep at 8+ |
| 20 | targetSdk meets Play's requirement | TO CHECK | `targetSdk = "36"`; CR-REL-1 | Verify the requirement in Play Console at release time |
| 21 | Teacher Approved | OPEN (not applied) | PROJECT_OVERVIEW: opt in after launch | Nothing before launch |
| 22 | Families badge in Data safety (optional) | TO CHECK | — | Opt in if the Console offers it |

## Content rating questionnaire (IARC) hints

Verify the category names and questions in the Console. Answers in **bold** describe the current app.

- Category: the non-game category for educational or reference apps.
- Violence, fear, sexuality, crude language, controlled substances, gambling or simulated gambling: **none**. Check the Sains and Sosial & Seni packs (history topics, for example) before answering.
- Users can interact or exchange content with each other: **No**.
- Shares the user's location with other users: **No**.
- Digital purchases: **Yes** (one-time packs via Google Play).
- Unrestricted internet or web browsing: **No**.
- Religious context: the Arabic track uses constructed practice sentences labelled «Kalimat latihan buatan — bukan ayat Al-Qur'an» (CR-ENG-2) and no Qur'an text (Trial_App_Spec §2). Usually this is not a rating trigger; answer honestly if asked.

## Other App content declarations

- **Ads:** No.
- **App access:** the Arabic trial needs consent from an adult 18+; all units unlock with a purchase or a tester code. Give the reviewers a tester code and short instructions [UMAR].
- **Government, financial, health or news features:** none.
