DRAFT 2026-10-17 — written by Claude; needs Umar's review and, for the privacy policy, a legal check against UU No. 27/2022 (UU PDP) before publication.

# Play Console Data safety answers — AyaIlmu

These answers apply to the `prod` flavor (`id.petalytix.ayailmu`). The form's wording changes over time, so check each question against the current help page ("Provide information for Google Play's Data safety section") before submitting.

## Play's definitions this rests on (checked 2026-10-17; verify again)

- **Collect** means transmitting data *from your app* off the user's device. Data processed only on the device does not have to be disclosed. Pseudonymous data that is transmitted must be disclosed.
- **Share** means transferring collected data to a third party. One exception covers a transfer "based on a specific user-initiated action" where the user reasonably expects it. That exception sits under *sharing*, not *collection*.
- **Payments:** data that Google Play's billing system collects directly from the user does not need to be declared if the app never accesses it.

## Where data goes (evidence)

| # | Flow | Leaves the device? | Evidence |
|---|---|---|---|
| F1 | Profiles, answers, reports, background and survey answers, consent record, tester-code status | No. Stored in Room and DataStore only | CR-DAT-1, CR-DAT-2; `core/data/.../db/Entities.kt` |
| F2 | Export: JSON and CSV written to the app cache, then handed to an app the **user picks** in the Android share sheet | Only if the user sends it, using another app | CR-DAT-4; `Export.kt` (`ExportFiles.write`); manifest `FileProvider` (`exported=false`, `grantUriPermissions`) |
| F3 | Play Billing: the app asks the Play Store app what the account owns and caches the owned product IDs | IPC to Google Play on the device; the app sends nothing to us | CR-BIL-2, CR-BIL-3; `core/billing/EntitlementCache.kt` |
| F4 | Android Auto Backup of the database and DataStore to the user's own Google account | Yes, by Android, to the user's account; we have no access | CR-DAT-6; `res/xml/data_extraction_rules.xml`, `backup_rules.xml` |
| F5 | Crash and ANR data shown in Android Vitals | Collected by Google/Android, not by an SDK in the app | CR-DAT-3; `libs.versions.toml` (no crash or analytics SDK) |
| F6 | Daily reminder | No. Local `AlarmManager` | CR-HAB-5; manifest `ReminderReceiver` |
| F7 | Tester code | No. Checked against bundled hashes | `content/src/main/assets/config/app_config.json` (`trial.tester_code_hashes`) |
| F8 | Optional remote config (CR-CFG-2) | Disabled: `REMOTE_CONFIG_URL = ""`, `remote_override_enabled: false`, no INTERNET permission in the app manifest | `app/build.gradle.kts`, `app_config.json`, `AndroidManifest.xml` |

Libraries in the runtime classpath: AndroidX/Jetpack (Compose, Navigation, Lifecycle, AppCompat, Room, DataStore), Hilt, kotlinx (coroutines, serialization) and Play Billing 8.0.0. No analytics, ads, attribution or crash SDK (`gradle/libs.versions.toml`, `app/build.gradle.kts`, `core/*/build.gradle.kts`). Roborazzi and Robolectric are test-only.

## Recommendation: Option A, "No data collected"

This matches the posture in PROJECT_OVERVIEW ("data stays on device"). Reasoning:

- F1, F6 and F7 never leave the device.
- F2 is not sent by our app. The app has no network code for it and no INTERNET permission. The user chooses a destination app and recipient, and that app sends the file. Play's text ties collection to "transmitting data from your app".
- F3: the app never accesses payment data, and Google collects it directly, which falls under the billing exemption. The owned-product list is read and kept on the device.
- F4 and F5 are Android/Google platform functions. They go to the user's account or to Google, never to us through app code.

**Judgement calls for Umar**

- **J1 (largest):** during the Arabic trial we ask testers to send their export to support@petalytix.id and then analyse it. A strict reviewer could treat that as collection by the developer, even though our app does not transmit it. Option A is defensible; Option B is the cautious alternative. [UMAR: confirm A or B]
- **J2:** the export currently contains **all profiles on the phone, including child profiles** (`SettingsViewModel.export` calls `profiles.all()` and `answers.allEvents()`). Under Option B this would mean disclosing data from children. Restricting the export to consenting adult trial profiles makes both options cleaner. [UMAR: decide]
- **J3:** Auto Backup is treated as not collected because it goes to the user's own account and is end-to-end encrypted on recent Android versions when a screen lock is set. [UMAR: confirm; verify on the current help page]
- **J4:** Android Vitals data is treated as Google's own collection, not the app's. [UMAR: confirm]
- **J5:** before each submission, open Android Studio → Merged Manifest for `prodRelease` and confirm that no library added INTERNET or other permissions you did not expect. If the merged manifest shows INTERNET, Option A still holds because no code of ours sends data, but update the comment in `AndroidManifest.xml`.

## Answers, question by question

### 1. Data collection and security

| Question | Option A answer | Justification |
|---|---|---|
| Does your app collect or share any of the required user data types? | **No** | F1–F8 above; no network code (CR-ARC-7) |
| Is all user data collected by your app encrypted in transit? | Not asked after "No" (verify) | Nothing is transmitted by the app |
| Account creation | "My app does not allow users to create an account" (if asked) | No account or login; the learner ID is a random on-device UUID (CR-DAT-2) |
| Do you provide a way for users to request that their data is deleted? | Not asked after "No"; Option B answer below | In-app delete (Settings), plus email for files already sent |
| Committed to follow the Play Families Policy (optional badge) | **Yes**, if the Console offers it | PROJECT_OVERVIEW "Play policy posture"; `families_self_review.md` |
| Independent security review (optional) | No | Not done |

### 2. Data types

Option A: none.

### Option B (cautious fallback if J1 goes the other way)

**Collected: Yes. Shared: No** (the user sends files to us, not to third parties).

| Play data type | What it covers | Required or optional | Purpose |
|---|---|---|---|
| Device or other IDs | Random learner ID | Optional (only if the user exports) | Analytics |
| App activity → App interactions | Answers, timestamps, time on item, hints, scores | Optional | Analytics |
| App activity → Other user-generated content | Typed answers, report notes, survey free text | Optional | Analytics |
| App activity → Other actions | Background answers, survey choices, question-report reasons | Optional | Analytics |

- **Processed ephemerally:** No.
- **Encrypted in transit:** this depends on the channel the user picks (email TLS, WhatsApp). The app cannot guarantee it. [UMAR: decide how to answer; this uncertainty is a reason to prefer A]
- **Deletion request:** Yes. Email support@petalytix.id with the learner ID; files are deleted no later than 6 months after the trial ends (`strings.xml` `consent_keep_body`, `consent_stop_body`).
- **Children:** if J2 is not fixed, add a note that child-profile answers may be included.
- [UMAR: confirm the type-to-category mapping. "Analytics" is our reading of "improve the lessons".]

## Consistency checks before submitting

- The privacy policy URL (`docs/store/privacy_policy.md`, once published) says the same things as this form and the consent texts (`strings.xml` `consent_*`).
- The store listing line "data tetap di HP kamu" (MONETIZATION_SCHEME) stays true.
- **Revisit this form** if any of these change: remote config is enabled (CR-CFG-2 sends a request with the device's IP to a static host), any SDK is added (CR-DAT-3), the export starts uploading, or Rive is added in P4 (check the Rive runtime's data practices).
