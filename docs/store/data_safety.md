# AyaIlmu store privacy disclosure worksheet

Updated 2026-11-11. **Not submission-ready.** Replaces the obsolete recommendation to select “No data collected” and “No accounts.” The current source has real account/authentication and optional server sync. A default build with those flags off is not evidence for the intended account-enabled public release.

## Verified flows

| Flow | Data and destination | Source |
|---|---|---|
| Registration, sign-in, confirmation, recovery | Email, password as required, verification codes and session data to configured GoTrue; confirmation/recovery mail through its email service | Android nonLab account gateway; current iOS account core; backend auth and audited private deployment |
| Account activation | Provider issuer/subject, adult declaration version/time, account ID to learning backend | backend store accounts and API |
| Learner creation | Local/server learner IDs, kind/audience, language; child creator relationship exists in store but normal ingress/client is currently adult-only | core/sync Contracts, HttpBackend; backend profiles; generalingress/request.go |
| Explicit sync | Answer content, including typed text; learner/item/session IDs, timing, scores, content/app/rule versions and review status to learning backend | core/sync SyncEngine, HttpBackend; backend answer_events |
| Consent | Owner/learner IDs, purpose/version, granted/revoked state and timestamp on server | sync_consents; consent endpoint |
| Operational traffic | IP and request metadata processed by network/auth/mail/rate-limiting infrastructure; exact logs, recipients, locations and retention still need inventory | deployment and general ingress configuration |
| Export | User-selected JSON/CSV share; may include all local profiles, including children; excludes label/birth year | Export.kt and SettingsViewModel |
| Account deletion and recovery (source-only) | Owner/request IDs and fresh session for confirmed initiation; separate device-secret proof for minimal anonymous receipt status. Proof is kept in Keystore/Keychain storage, excluded from learning export and ordinary logout cleanup | Native account-erasure stores, backend account deletion/status contracts |
| Device storage and platform backups | Local profiles/history/settings; platform-dependent backup rules; separate from app sync | Room/DataStore, manifest, backup XML |
| Payments and diagnostics | Google Play entitlement checks if enabled; platform diagnostics, with no analytics/ads/crash SDK found in audited source | billing module, Gradle dependencies |

## Proposed classification for an account-enabled release

These are review inputs, not answers already submitted to Google or Apple. Check current store definitions and the exact signed binary before submission.

- **Collection:** Yes. Optional sync and account traffic leave the device through app code. Pseudonymous IDs and learning answers are still data. User choice does not make this “no collection.”
- **Account creation:** Email/password account creation exists when configured. Do not select “my app does not allow account creation.” Enumerate any additional sign-in method only after it is actually enabled and tested.
- **Candidate categories:** personal information/email address and user IDs; app activity/interactions; user-generated content for typed answers; other activity where applicable. Account credentials and verification/session data need review against each store's current definitions. Payment/order data depends on what the release actually accesses. Do not infer device advertising-ID collection from an app-generated learner ID.
- **Purpose:** Account management, app functionality, syncing/restoring progress and security/fraud prevention. Content-review/analytics purpose applies only to the specific export or learning-data use actually authorized and operated; do not invent additional uses.
- **Optional/required:** Account information is required to provide an account, not to justify every offline feature. Learning upload requires explicit per-profile consent. Match the form's per-type wording to the release behavior.
- **Ephemeral:** No for server accounts, consent and synced answers; they are stored. Rate-limiting/log retention needs its own verified answer.
- **Sharing:** Inventory hosting/authentication/email and platform providers, contracts, purposes and countries. Apply store service-provider/user-action exceptions only after review. Do not claim “no third parties” merely because there are no ad SDKs.
- **Encryption in transit:** Native normal sync requires HTTPS and disables HTTP redirect following; authentication/other transports and production infrastructure still require release verification. Private localhost certificates do not prove publicly trusted production TLS. User-selected exports have their selected service's security.
- **Deletion:** Local deletion is implemented; it is not server or account deletion. Source-only learner erasure now exists, but native end-to-end acceptance and deployment remain open. Full backend account/provider coordination now exists in source with pending/completed receipts; native account-wide controls are implemented in isolated source. Real-device lifecycle checks, actual provider/deployment acceptance and a working web deletion-request URL remain launch blockers. Do not answer this as complete based on an email address or unshipped endpoint.
- **Children:** Export may include child-profile data. Family cloud sync is not fully implemented in normal ingress/clients. Complete guardian consent, child deletion, data minimization and Families/legal review before enabling or advertising those flows. Do not claim a Families compliance badge without the required review.
- **Tracking/advertising:** No ads/tracking SDK found. Recheck runtime dependencies, network behavior and provider practices before final Apple/Google answers.
- **Independent review:** Automated tests and an engineering source review are not an independent security certification.

## Required release evidence

1. Public account/API origins, certificate chain, production policy versions and provider configuration match the signed build. No owner-only, local QA or synthetic route is substituted for public functionality.
2. Real authorized signup, inbox confirmation, login, recovery, restart, sync and restore pass on supported devices. No test users are introduced into production without explicit approval.
3. Learner and full account deletion complete across app database, authentication identity/session state, durable retry and backups under a documented policy; the web route is reachable.
4. Exact retention/access/processor/country inventory is approved and implemented. Existing six-month trial-export language must be reconciled with operations, not silently treated as proven.
5. Privacy policy, in-app consent, signed build, website and both stores agree. Android/iOS feature differences are explicit. The intended full feature scope is preserved as launch work.
6. Store definitions and category mappings are checked at submission time. No store submission or public policy publication occurred as part of this worksheet update.
