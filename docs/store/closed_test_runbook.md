DRAFT 2026-10-17 — written by Claude; needs Umar's review and, for the privacy policy, a legal check against UU No. 27/2022 (UU PDP) before publication.

# Arabic closed test runbook (no backend)

Goal: M5 (BUILD_PLAN P7): at least 12 testers, 14 days, no P0. The trial runs at least 5–6 weeks so D30 checks happen (Trial_App_Spec §3).

## 0. Before anything

- [ ] The **support@petalytix.id** mailbox exists on Rumahweb and can receive attachments (PROJECT_OVERVIEW).
- [ ] The consent text (`arab-trial-1`) and the privacy policy have had the UU PDP legal check. The policy is live on petalytix.id.
- [ ] Decide the export scope: today the export includes every profile on the phone, child profiles too (`data_safety.md` J2). [UMAR]
- [ ] The go/no-go checks in §9 pass.

## 1. Create the app in Play Console

1. In Petalytix's existing account (AyaKasir), create **AyaIlmu**: default language Indonesian, *App*, *Free*.
2. **Is the closed test mandatory?** Google requires at least 12 testers opted in continuously for 14 days only for *personal* accounts created after 13 Nov 2023 (checked 2026-10-17; verify on the current page). For an organisation account it is our own plan, not a Google gate; run it anyway. [UMAR: confirm account type]
3. The package name is fixed by the first upload: **`id.petalytix.ayailmu`**, from the `prod` flavor. Never upload the `demo` flavor (`.demo` suffix, shows unapproved content).

## 2. Signing and the first build

1. New upload keystore, not AyaKasir's (CR-REL-5); enrol in Play App Signing; record path and alias (no secrets) in SESSION_LEARNINGS.
2. Run the CR-REL-2 gate including `:app:assembleProdRelease`, then build the bundle with `./gradlew :app:bundleProdRelease`.
3. Upload it to **Internal testing** with you as tester. Play needs an uploaded build that uses Billing before it lets you create products.

## 3. App content (Policy → App content)

Fill in the privacy policy URL, Ads (No), App access (give the reviewers a tester code, see §5), content rating and target audience (`families_self_review.md`), and Data safety (`data_safety.md`).

## 4. Products, licence key, licence testers

**One-time products** (Monetize with Play → Products; the menu was formerly called "In-app products"). All are non-consumable. Prices are DECIDED in MONETIZATION_SCHEME:

| Product ID | Price (IDR) |
|---|---|
| `pack_bahasa_lifetime` | 79.000 |
| `pack_matematika_lifetime` | 59.000 |
| `pack_sains_lifetime` | 59.000 |
| `pack_sosial_seni_lifetime` | 59.000 |
| `all_access_lifetime` | 149.000 |

IDs never change once live. Titles and descriptions in ID + EN, Play's local price templates elsewhere; activate each.

**Licence key** (Monetization setup → Licensing): copy the Base64 RSA public key into the build machine's `%USERPROFILE%\.gradle\gradle.properties` (that is, `~/.gradle/gradle.properties`) as:

```
ayailmu.playLicenseKey=MIIBIjANBg...
```

Never in `android/gradle.properties` or the repo (CR-BIL-7). An empty key skips the signature check, so the closed-test build **must** carry the key.

**Licence testers** (Settings → License testing): add your and the testers' Google accounts (test cards, no charge). On internal testing run the M4 checks: approved card; slow card → "menunggu pembayaran", no early unlock; declined card; «Pulihkan pembelian»; airplane-mode launch; refund revokes access.

## 5. Tester codes

1. One code per tester plus spares (e.g. 20 for 15 testers); new hashes later need a new build. `python android/tools/tester_code.py 20` prints 20 codes, each with its SHA-256 hash. A code looks like `AYA-XXXXX-XXXXX-XXXXX-XXXXX` (20 random characters, about 100 bits). Do not shorten it: the hashes ship inside the APK, and a short code could be guessed back from its hash.
2. Paste the hashes into `android/content/src/main/assets/config/app_config.json` under `"trial": { "tester_code_hashes": [ ... ], "tester_until": "YYYY-MM-DD" }`. `tester_until` is the last day of the test (inclusive) and is **required** whenever there are hashes; the config is refused without it. After that day the codes stop opening units, even on phones where they were entered. Bump `config_version` (CR-CFG-1). Commit **only the hashes**.
3. Keep the code → tester list in a private place outside the repo [UMAR: where].
4. Send each code privately (individual WhatsApp or email), never in a group.
5. A code leaked? Ship a build without its hash. Phones that already used it keep tester access until `tester_until`, unless that build lists no hashes at all (then tester access is off everywhere). For the production release, empty `tester_code_hashes` and set `tester_until` back to `null`.

## 6. Closed testing track

1. Closed track (e.g. "Arab uji coba"), country Indonesia, testers via email list or Google Group; invite **at least 15** so 12 remain.
2. Promote the keyed build from internal testing and wait for review.
3. Send the opt-in link with the guide in §7. Opting out and back in restarts the 14 days.

## 7. What testers do (guide to send them, in Indonesian)

1. Open the opt-in link, then install AyaIlmu from Play. Use your own phone, with only your own profile if possible.
2. Create an adult profile and choose your birth year.
3. Enter your tester code in **Pengaturan → Kode penguji** (adult profile only).
4. Open Bahasa → Arab. Read the consent, confirm 18+, agree. Answer the four background questions (E-B1–E-B4).
5. Do the entry check, then one daily session of 10, 15 or 20 minutes each day. Optional: turn on the daily reminder in Settings.
6. If a question looks wrong, tap «Laporkan soal».
7. Fill in the short survey when it appears, around day 7 and at the end.
8. **Export:** Settings → «Ekspor data belajar» → share to **support@petalytix.id** by email. Do this after each survey and at the end [UMAR: schedule]. Do not uninstall the app or clear its data before the final export: everything lives only on the phone.
9. Note your learner ID (Settings, long-press to copy). You need it to ask for deletion.

## 8. Handling the exports (team)

1. Save files unchanged in [UMAR: location; team-only access]; log learner ID, date and file names.
2. Open the CSV in the spreadsheet (UTF-8 BOM; formula-like cells are prefixed with an apostrophe).
3. Filter `auto_score` for `waiting`. The Indonesian reviewer marks each typed answer right or wrong in a new column (CR-ENG-7). Never edit `raw_response`.
4. Read `reports` and the survey answers in the JSON. Fix content in the curriculum docs and packs; item IDs never change (CR-ENG-1).
5. Run the recompute tool on the exported files (PROJECT_OVERVIEW "Spec deviations").
6. **Deletion:** requests by learner ID within [UMAR: e.g. 30 days], confirmed by email. At trial end + 6 months (calendar reminder) delete every copy (mailbox, attachments, spreadsheets, downloads, backups) and log the date.

## 9. Go / no-go (Trial_App_Spec §14, adapted to no backend)

- [ ] **Content:** the prod build shows only `approved` items (CR-ENG-2). Both reviewers approved them. The clashes MT-B3/VT2 (ضَحِكَتْ) and MT-B2/VT1 (هَرَبَ) are resolved.
- [ ] **Audio:** all **75** entry-check clips play on the test devices. A forced audio failure shows "not assessed", never wrong.
- [ ] **Typed answers:** a sample list of right, wrong and borderline Indonesian answers, made with the Indonesian reviewer, scores as expected; unknown answers become `waiting`.
- [ ] **Freshness and order:** a test learner never sees READY, D7 or D30 items early. Reserved VRB-01 forms never appear early. Speech items use only Unit A sentences already seen.
- [ ] **Config without an app update:** **this cannot pass as written.** The app has no INTERNET permission and `remote_override_enabled` is `false`. [UMAR: decide] Either (a) enable the CR-CFG-2 signed static override (adds INTERNET; revisit Data safety), or (b) record a deviation: config changes ship as a new closed-track build. Either way, verify that recomputing from exported answers reproduces the in-app states.
- [ ] **Data:** export works end to end (file arrives at the mailbox and opens in the spreadsheet). The §14 item "offline answers sync later" does not apply (no sync).
- [ ] **Consent and privacy:** the consent screen works, including the 18+ refusal and withdrawal. The policy is live. Data safety is submitted.
- [ ] **Arabic display:** harakat render correctly on a low-end phone, a tablet and several font sizes (the iOS part does not apply).
- [ ] **Billing and codes:** the build carries the licence key; the products are active; a tester code unlocks all units on a clean install.
