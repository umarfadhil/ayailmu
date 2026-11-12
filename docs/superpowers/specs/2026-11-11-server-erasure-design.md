# Server erasure design

This source-only implementation advances public launch. It does not authorize a deployment, database migration, provider credential, or deletion of existing user data.

## Intent and existing decisions

Users must be able to remove a learner's cloud copy and delete their account without misleading success messages or leaving old requests able to recreate erased data. Learning on the device remains available independently. The existing family design says withdrawal erases the server copy and keeps local data. Current `backend-umar` is the inspected running backend, despite older plans naming a different backend; this work targets the running contract and does not perform an architecture migration.

## Approach

Extend the current owner-scoped API and PostgreSQL store. Do not grant unrestricted DELETE or weaken immutable history for ordinary runtime writes. Narrow database erasure functions run with their owner privileges, validate ownership and request identity, and return durable receipts. Exact tombstones prevent old learner-creation retries from recreating a deleted cloud copy.

Alternatives rejected: deleting only device data does not meet the goal; deleting app data while reporting the provider account deleted is false; broad runtime DELETE/trigger privileges would weaken the current boundary. A new standalone deletion service would create unnecessary deployment infrastructure.

## First independently testable slice: learner erasure

`POST /v1/learners/{uuid}/deletion` accepts `request_id` (UUID), `confirmed: true`, and the existing synthetic-mode marker. It requires an authenticated, recently signed-in owner, explicit confirmation, and matching deployment mode. A normal user's right to erase must remain available if normal learning readiness is later switched off.

The transaction serializes with profile creation and answer writes, deletes only that learner's server events/consents/profile, records an opaque receipt and client-identity tombstone, and returns the same receipt on a repeated request. A request ID reused for a different target is a conflict. A foreign/unknown learner is not found. Deleting an adult with server child dependents is a conflict; it never implicitly deletes those children. Whole-account deletion will explicitly cover every learner.

No local answers are deleted by this API. Clients stop sync durably before sending erasure, preserve the request ID across interruption, and retain a disabled cloud binding with its exact receipt so offline history and pending retries remain reachable. Errors never claim deletion completed. Existing consent pause behavior must not be silently relabeled as erasure until the native client is switched to the new path.

## Full account deletion, subsequent slice

Account deletion must coordinate GoTrue identity removal, all app learner data, tokens and a durable retry receipt/tombstone. A provider outage or uncertain response must remain pending, never successful. Stale tokens must not reactivate the erased account. Source adapters and tests may be added without production admin credentials; absent provider configuration must fail closed. Public activation and any provider authority need separate authorization.

The source-only implementation now includes `internal/identityerase`, `internal/accounterase`, additive migration 0005, authenticated begin/proof-only status routes and explicit runtime configuration. App data erasure and account tombstones commit atomically before an issuer-bound leased provider job runs. Pending/completed status survives Auth identity removal via a client-generated 256-bit recovery proof, stored only as a hash on the server. No live configuration or credentials were changed. Native full-account request/recovery controls and actual provider/deployment acceptance remain open. See `docs/integration/ACCOUNT_ERASURE_READINESS.md` for exact semantics, tests and activation prerequisites.

## Privacy and remaining decisions

Disclosures describe actual device storage, optional cloud account/sync, email provider, local versus server deletion, and current limits. They cannot promise a retention period, legal approval, backup deletion timetable or provider erasure not implemented and verified. Those are explicit release blockers, not placeholders to publish.

## Verification

Run real disposable-Postgres tests for ownership, stale authentication, idempotency, concurrent append/create, guardian dependencies, runtime privilege limits, row erasure and stale replay. Test exact HTTP ingress routing, then native transport/state behavior. Never point tests at live app data.
