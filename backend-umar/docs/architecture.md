# Umar native backend — local prototype, 2026-10-18

## Purpose and boundary

Build a separate backend for Umar's Kotlin AyaIlmu, starting from verified remote
`815e30f0da284b9818fadc0143f4da92544384d3`. No Amar backend, React Native,
identity, database, or mastery contract is reused. Native source is unchanged.
Current native policy says answers never leave the device; this backend does not
change that policy or add a client. All write endpoints require `synthetic:true`.
There is deliberately no configuration switch to accept real learner data.

## Source contracts verified

- `android/core/model/.../AnswerEvent.kt`: immutable snake_case event; raw_response
  is a JSON **string**, not a nested object; opaque IDs need not be UUIDs.
- `Scoring.kt`, `ItemType.kt`, `feature/session/AnswerDraft.kt`: six response kinds;
  trace uses sequence/dont_know; story uses choice `seen`, outcome not_assessed.
  speed_round is not an emitted item type. Optional serializer defaults may be absent.
- `core/data/.../ProfileRepository.kt`: ADULT/adults and ANAK/kids; child creator is
  an existing adult. Native ADULT includes teens 13+, so it is **not** proof of
  adulthood. Backend account owners declare age 18+; teen learners remain guardian-owned.
- `core/data/.../db/Entities.kt`: labels and birth years are local-only. Neither is
  accepted here. Surveys, reports, snapshots, audio, drawings and device identifiers
  are outside this slice. Stroke IDs are history; raw tracing coordinates are rejected.
- Assets: six subjects, 73 tracks, 3162 items, all draft; Arabic has 17 synthetic
  items, adults only. Registry pins every pack and rules file by SHA256.

## Architecture

One Go HTTP service + Postgres + separate self-hosted Keycloak realm. Go avoids a
runtime framework and supports a small VPS. SQLite would simplify a demo but miss
concurrent replay/ownership behavior; a managed backend would add an unwanted hosted
dependency. Keycloak owns passwords, login, MFA, sessions and key rotation. API uses
coreos/go-oidc JWKS verification (RS256), exact issuer/audience, expiry, nbf, bearer
token type, permitted client and `umar.sync` scope. No custom crypto or passwords.
Native integration would use authorization code + PKCE S256 via system browser.

Keycloak and API use separate local Postgres instances and volumes. Compose project
`umar-native-backend`, API `127.0.0.1:8185`, Postgres `127.0.0.1:6585`, auth
`127.0.0.1:8285`; no connection to existing services. Dev-only Compose, not a
production deployment. No public bind or external resources. Secrets are generated
locally into ignored files and never committed.

## Schema and ownership

- accounts: generated UUID, unique (issuer, subject), adult declaration version/time.
  Only opaque provider IDs are retained. Authenticated identity alone creates nothing.
- learners: server UUID, owner FK, client learner ID scoped to owner, ADULT/ANAK,
  audience derived from kind, instruction language, adult creator FK for ANAK.
  No owner reassignment or child login. Adult creators must belong to the same owner.
- sync_consents: append-only grant/withdraw history, purpose `synthetic-offline-sync`,
  version `synthetic-sync-v1`, server time and granting owner. `arab-trial-1` is not
  sync consent. New opt-in/revocation requires authentication within five minutes.
- pack_versions: unique (track, content_version), source commit, raw pack and rules
  hashes, rules version, audience/language and item metadata; metadata only, no release.
- answer_events: per-learner sequence, unique (learner, answer_id), exact event bytes
  in bytea, SHA256 for replay identity, registry status. Trigger prevents UPDATE/DELETE.
  Deletion/export/retention for real users are not implemented; real data is blocked.

All learner operations query by owner from verified token; other owners see 404.
Child consent requires the owner, a same-owner adult creator and fresh auth; a
client boolean is never an adult gate. Declaration is a prototype attestation,
not legal age verification. All children in tests are fabricated.

## API v1

| Method/path | Contract |
|---|---|
| GET /healthz, /readyz | liveness; database readiness, no credentials/details |
| POST /v1/account | fresh auth, adult declaration version `adult-owner-v1`, synthetic=true; idempotent |
| POST /v1/learners | client_learner_id, kind, lang, created_by optional, synthetic=true; deterministic replay or 409 |
| GET /v1/learners | only token owner's minimal profiles |
| POST /v1/learners/{id}/consent | fresh auth, granted boolean, version `synthetic-sync-v1`, synthetic=true |
| GET /v1/packs | source-pinned metadata incl. draft counts; authenticated |
| POST /v1/learners/{id}/events | `{schema_version:1, synthetic:true, events:["<exact native JSON>"]}`; 1–100 events, 1 MiB request |
| GET /v1/learners/{id}/events?after=N&limit=N | learner-local monotonic cursor, 1–100 entries, exact payload strings |

Event payload learner_id must equal this owner's bound client_learner_id. Native
IDs and payload bytes are never rewritten. Stable frozen payloads permit retries:
same answer_id + exact bytes => duplicate receipt; changed bytes => 409 conflict.
Batch is atomic, including conflicts mid-batch; clients keep their outbox until a
200 receipt, retry network failures, stop on 409, and never skip rejected events.
Unknown versions/items remain `unregistered` and are retained, not projected.
Registered metadata disagreements are rejected. No server scoring or mastery.
Raw response shape/type is validated; free text is forbidden for ANAK. Draft or
synthetic registry entries never imply approved content. GET returns history only.

Per-learner locked transactions assign sequence numbers only after acquiring the
learner row lock, preventing a committed high cursor from hiding a concurrent lower
one. Different learners have unrelated cursor spaces. Revocation shares that lock,
so uploads cannot race past a completed withdrawal; read/download also requires
active consent. Regrant restores existing history without mutating events.

## Release blockers

Before real integration: Umar's native policy decision; purpose-specific adult and
guardian consent and age assurance review; updated store/privacy statements;
export/deletion/retention design; threat review, operational TLS/backups/rate limits,
OIDC browser client and device opt-in UX. Native mastery remains unchanged and must
not ingest this history until a separately reviewed adapter/reconciliation design.
