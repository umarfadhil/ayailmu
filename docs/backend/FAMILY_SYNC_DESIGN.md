# Family sync design — `backend/` with Android and iOS clients

**Status:** PROPOSAL 2026-10-22 (PLANNED). Lines marked **DECIDED** are Umar's decisions of 2026-10-22; everything else is Claude's proposal for Umar to approve before Amar implements (CR-SES-2). Once built, the HTTP details move into `backend/docs/Backend_Local_Contract.md` (its tests win) and this file keeps only the reasoning.

## 1. Decisions (Umar, 2026-10-22)

- **DECIDED** `backend/` (Go API + PostgreSQL + self-hosted GoTrue) is the product backend; hosting plan Cloud Run (API + GoTrue) with Supabase providing PostgreSQL only. Nothing is deployed and no real learner data is accepted until the go-live gates in `ai-memory/PROJECT_OVERVIEW.md` are met.
- **DECIDED** Learning never needs an account. Account and sync are opt-in, per profile.
- **DECIDED** The first sync release covers **Adult and Anak** profiles.
- **DECIDED** Withdrawing sync consent for a profile **deletes that profile's server copy**. The device keeps its data.
- **DECIDED** iOS is a SwiftUI app on a shared Kotlin core and uses the same API (BUILD_PLAN track I).

## 2. Gap between `backend/` today and the decisions

| Area | `backend/` today (PR #2 head 37758c1) | Needed |
|---|---|---|
| Profiles | `kind = 'adult'` only (migration 0001 CHECK; import refuses other kinds with `422 unsupported_profile_kind`) | Adult and Anak, guardian ownership (§3) |
| Consent | one `{version, at}` string fixed at import; never changes | per-profile, append-only sync consent with grant and withdraw (§4) |
| Withdrawal | only whole-account deletion (`POST /v1/me/deletion`) | per-profile erasure on withdrawal (§4) |
| Sources | `app` ∈ `expo`, `android` | add `ios` |
| Adult proof | none beyond the token | adult declaration on the account (§3) |
| Curriculum registry | hand-embedded; pins 2 Android packs + 3 Expo packs; two pins already drifted, so 72 of 73 Android tracks are unregistered (§7) | generated from the catalog, checked in CI |
| Android client | none for `backend/` (PR #3's `:core:sync` targets `backend-umar/`) | rework of PR #3 onto these routes (§8) |

Already right and kept: accounts keyed by `(issuer, subject)` with no email/name stored; no label, name or birth year anywhere on the server; envelope v1 already accepts the Kotlin `AnswerEvent` (`schema: kotlin.answer_event`, fixtures `backend/contract/fixtures/kotlin-v1-*`); immutable events with idempotent replay; export and deletion with recent-sign-in step-up; deletion ledger.

## 3. Ownership model

- **Account** = one adult (the guardian). Signs in with GoTrue. On first use the app shows the adult gate (the CR-BIL-5 gate) and records an adult declaration: `adult_declaration_version` (e.g. `adult-owner-1`) and time. This is an attestation, not age verification.
- **Profiles** under the account mirror the device profiles: `kind` = `adult` | `anak` (content audience, as on the device).
- **Guardian-managed profiles:** every Anak profile, and every device Adult profile whose local birth-year bound allows an age under 18 (the device Adult kind starts at 13, `ADULT_MIN_AGE`). These carry `guardian_managed = true` and `created_by_profile_id` = an adult, non-managed profile of the same account (mirrors `ProfileEntity.createdBy`). The device decides `guardian_managed` at link time from its local birth year; the birth year itself never leaves the device. *(OPEN for Umar: confirm teens 13–17 are guardian-managed.)*
- No child login, no child email, no child identity at GoTrue. Only the guardian authenticates.
- **Device link** stays `(app, install_id, local_profile_id)`; `app` gains `ios`.

## 4. Consent and withdrawal

- Sync consent is separate from the Arabic trial consent (`arab-trial-1`). Purpose `sync`, version `sync-1`; texts in ID + EN, legal review against UU PDP before go-live (OPEN).
- Stored append-only per profile: `profile_id, purpose, version, action (grant|withdraw), by_account, at (server time)`.
- **Who grants:** an adult profile grants for itself; a guardian-managed profile is granted by the guardian on the guardian's device, behind the adult gate and a recent sign-in (≤ 5 min, the same step-up as export/deletion).
- **Ingest rule:** events, imports and pulls for a profile need an active grant, otherwise `403 sync_consent_required`.
- **Withdrawal (DECIDED: delete):** one transaction records the withdraw row, erases the profile's events, imports, source links and settings, tombstones the profile so a replayed import cannot recreate it, and writes a deletion-ledger row with `scope = profile`. Response: a deletion receipt. The client then marks the local profile unsynced and keeps all local data.
- Whole-account deletion (`/v1/me/deletion`) stays as is and covers every profile.

## 5. Data minimisation for guardian-managed profiles

- Same as today: no label, name, birth year, email or phone on the server.
- Events keep the scored answer. Proposed: refuse raw trace coordinates (store the outcome only) and keep typed answers as typed (they are learning evidence). Free-text item reports are adult-only on the device and are not part of sync.
- Retention for inactive profiles: OPEN (proposal: erase a profile's server copy after 24 months without a sync, with the same erasure path as withdrawal).

## 6. API changes (additive, v1)

| Change | Detail |
|---|---|
| `POST /v1/imports` | `target.new_profile.kind` accepts `anak`; new members `guardian_managed`, `created_by_profile_id` (required when managed); `consent` becomes `{"purpose":"sync","version","at"}` and counts as the first grant; managed profiles need a recent sign-in |
| `POST /v1/profiles/{pid}/consent` | new: `{"action":"grant"|"withdraw","version"}`, recent sign-in; withdraw answers `200` with the deletion receipt, afterwards the profile is `404` |
| `GET /v1/me` | profiles add `kind`, `guardian_managed`, `created_by_profile_id`, `consent: {state, version}` |
| `POST /v1/account/declaration` | new: records the adult declaration; required before the first import |
| Sources | `app` accepts `ios` |
| Errors | `403 sync_consent_required`, `422 guardian_required`, `422 declaration_required`; `401 reauthentication_required` reused |

Schema (migration 0004): `accounts` + `adult_declaration_version`, `adult_declared_at`; `profiles.kind` CHECK `('adult','anak')`, + `guardian_managed`, + `created_by_profile_id` (FK within the account, creator must be adult and not managed, CHECK managed ⇔ creator set); new `profile_consents` (append-only trigger, erasable only by the withdrawal/deletion path); `profile_sources.app` CHECK adds `ios`; deletion ledger + `scope`.

## 7. Curriculum registry (blocker found 2026-10-22)

`backend/internal/curriculum/packs.go` pins pack bytes by SHA-256. Two pins no longer match:

| Pack | Registry pin | Current bytes |
|---|---|---|
| `android/content/.../matematika/mat/v1.json` | `mat-sample-0.2`, `ae93ba08…` (as of 117df50) | `mat-k-pemula-0.3`, `25e656a5…` on main |
| `prototype-expo/src/content/fixtures/demo-v0.3.json` | `af0c4bdd…` (ef28606) | `80eb638a…` after PR #5's 7f5d9a7 |

So `internal/curriculum` tests fail once #2 meets current main, and 72 of the 73 Android catalog tracks are unregistered — only `arab` `demo-synthetic-0.1` still matches (lookup is by family, track and content version; unregistered events are still stored, as `curriculum_status = unregistered`). Proposal: generate the registry from `android/content/src/main/assets/config/catalog.json` (+ each pack and rules file) and the Expo fixtures with a script (`backend/tools/gen_registry.py`, same idea as PR #3's `backend-umar/scripts/generate_registry.py`), commit the output, and have backend-gate fail when regeneration changes anything.

## 8. Clients

### Android — rework of PR #3

- **Keep from #3:** the pure-Kotlin `:core:sync` shape (contracts, `SyncEngine`, journal), consent-gated sync, Tink-encrypted token storage, the payload DAO queries, `AyaTextField(visualTransformation)`, its tests as a starting point.
- **Re-point** the `Backend` interface at `backend/`:

| PR #3 call (`backend-umar/`) | `backend/` route |
|---|---|
| `account()` / `currentAccount()` | `POST /v1/account/declaration` (new) and `GET /v1/me` |
| `learners()` | `GET /v1/me` → `profiles` |
| `createLearner(clientId)` | `POST /v1/imports` with `target.new_profile` and source `(android, install_id, local_profile_id)` |
| `catalog()` | `GET /v1/curricula` |
| `consent(learner, granted)` | `POST /v1/profiles/{pid}/consent` (new) |
| `append(payloads)` | `POST /v1/profiles/{pid}/events` (envelope v1, ≤ 500 per batch) |
| `pull(after)` | `GET /v1/profiles/{pid}/events?after=` |

- **Build:** drop the `syncLab` flavor; sync is compiled into `demo` and `prod` and is off (no UI, no network) while `BuildConfig.SYNC_BASE_URL` is empty — the same pattern as `REMOTE_CONFIG_URL`. Tink and AppAuth go into `libs.versions.toml`.
- **Drop from #3:** `backend-umar/`, `integration/`, `integration-jvm/`, the ngrok tunnel plan, and the 16 `docs/integration/` checkpoints (their findings fold into SESSION_LEARNINGS).
- **UI:** Settings → "Sinkronkan" per profile; guardian flows behind the adult gate; never shown on an Anak profile without the guardian.

### iOS

Same API with source `app = ios`. Sign-in providers: OPEN — if Google sign-in is offered on iOS, check App Store Review Guideline 4.8 (login services) before choosing.

### Expo reference

Unchanged; reference only.

## 9. Proposed rule changes (not yet in CODE_RULES)

- **CR-ARC-7 (replace):** "Network code lives only in `:core:sync`, Play Billing and the static config fetch. `:core:sync` talks only to `BuildConfig.SYNC_BASE_URL` over HTTPS (empty = sync off, no sync UI), uses no analytics, ads or attribution SDK, and sends nothing for a profile without an active sync consent. Any other network import is a review blocker."
- **CR-DAT-4 (amend):** "nothing leaves the device otherwise" → "nothing leaves the device otherwise, except opt-in sync (CR-ARC-7)".
- **New CR-BE-1:** "The backend accepts only synthetic data until PROJECT_OVERVIEW's go-live gates are signed; every deployment, public endpoint or tunnel needs Umar's approval at the time."

## 10. Open for Umar

1. Teens 13–17 guardian-managed (§3).
2. Sign-in providers: email + password, Google, Apple.
3. Retention for inactive profiles (§5).
4. Consent texts (ID + EN) and the UU PDP review.
5. Approve §9 rule changes when B3 starts.
