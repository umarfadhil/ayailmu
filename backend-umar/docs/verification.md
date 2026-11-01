# Local verification — 2026-10-18

## Location and scope

- Worktree: `/Users/amarmaruf/Documents/Codex/2026-10-18/task/umar-native-backend`
- Branch: `feature/umar-native-backend-20261018`
- Backend: `backend-umar/`
- Base: `815e30f0da284b9818fadc0143f4da92544384d3`; public remote main rechecked
  after implementation and still identical (2026-10-18, about 14:56 UTC).
- Managed-worktree creation was unavailable for this delegated task. A separate
  bare local repository copy at `../.umar-repo.git` backs this isolated worktree;
  it has no hardlinked objects or shared writable Git state with older checkouts.
- Only `backend-umar/` differs from the pinned native main. No Android, Expo, Amar
  backend, existing worktree, shared identity, database or runtime was modified.
- One Codex implementer; a Codex GPT-6.1-sol xhigh agent performed read-only review.
  [Review findings and fixes](review.md). No Claude task or writer was invoked.

## Implemented milestones

| Milestone | Verified behavior |
|---|---|
| Database | transactional checksum migrations, advisory startup lock, repeatable registry seeding, health/readiness |
| Auth | maintained coreos/go-oidc RS256/JWKS verifier and separate self-hosted Keycloak; issuer/audience/client/type/scope/expiry/nbf checks |
| Ownership | adult-owner declaration, minimal ADULT/ANAK mappings, same-owner adult creator, foreign reads/writes/consent hidden with 404 |
| Consent | separate synthetic sync purpose/version; fresh-auth grant/withdrawal history; no reuse of Arabic trial consent |
| Registry | 6 subjects, 73 tracks, 3162 draft items, 17 Arabic synthetic items; exact pack/rules SHA256 and source commit |
| Events | all 20 emitted catalog activity types, six response kinds, trace sequences and story seen events; exact payload bytes, SQL immutability |
| Offline sync | atomic retries/conflicts, duplicate receipts, per-learner cursors, pagination, concurrent replay and withdrawal ordering |
| Privacy boundary | synthetic-only write contracts; no label/birth-year fields, child typed text rejected; native networking and mastery untouched |

## Tests and evidence

Final source passed **14 top-level tests + 37 subtests**, with **zero failures,
zero skips and no race reports**, against both database versions:

- [Postgres 17.11 full race output](evidence/race-postgres17.txt), run via
  `scripts/integration-compose.sh` against a new disposable database in only this
  project's container. The test database was removed afterward.
- [Postgres 16 full race output](evidence/race-postgres16.txt), run via
  `scripts/integration.sh` against a new temporary Postgres.app cluster on port
  16585. That cluster was stopped and removed afterward.
- [Real Keycloak 26.8.1 smoke](evidence/keycloak-smoke.json): real authorization
  code + PKCE S256, native password grant disabled, ID token rejected as bearer,
  registered trace/story upload, byte-preserving pagination, duplicate retry and
  withdrawal blocking the next upload. Ran again against the reviewed binary.
- `go vet ./...`, `go build -trimpath -o bin/umar-api ./cmd/server` and Python script
  syntax compilation passed. `git diff --check` passed.
- [Official govulncheck output](evidence/govulncheck.txt): no vulnerabilities found.
  The initial scan found reachable GO-2026-6629 and GO-2026-5970 through the driver's
  older transitive x/text version. Updated to x/text v0.43.0 (and required x/sync
  v0.24.0); reran the full suites and scanner successfully.
- Registry regeneration from the pinned Git object produced byte-for-byte identical
  output. The independent reviewer also verified each source hash.
- `.local/` secrets and `bin/` are ignored; no secrets or generated runtime are staged.

Test-first evidence includes missing implementations failing before event/registry,
store, auth and HTTP implementation; an empty database URL failing before the
fail-closed configuration guard; five case aliases and a child-response bypass
failing before exact property checking; four nonnullable null cases failing before
nullability enforcement. Concurrency tests use real Postgres row locks, not mocks.

## Running state and launch

The reviewed host API is running at `http://127.0.0.1:8185`; `/healthz` and `/readyz`
return 200. Its process uses only `backend-umar/bin/umar-api` and this worktree.
Compose project `umar-native-backend` has three running services:

- API Postgres: loopback `6585`, database `umar_native`, project volume `umar_data`.
- Keycloak: loopback `8285`, realm `umar`, public native client `umar-native`.
- Identity Postgres: internal-only, database `umar_identity`, volume
  `umar_identity_data`. It is separate from the API database and all older services.

New local secrets are in ignored `.local/` with restrictive permissions. The launch
commands and safe stop commands are in [README](../README.md). The task's verified
Go 1.27.2 toolchain and build caches are outside the repository in `../.runtime/`.
No globally installed toolchain or system configuration was changed.

One local post-smoke idle snapshot: Keycloak about 598 MiB under its 768 MiB cap;
the two Postgres containers about 44/49 MiB. This is not a capacity benchmark or
production VPS sizing claim. Production sizing and operations remain open.

## Decisions and remaining blockers

The user authorized local implementation with one writer and no push/merge. The
branch and worktree are retained locally; no push, PR, merge, deployment, hosted
resource, paid service, production credential or real-user operation occurred.

Decisions made within that scope:

- Use Go/Postgres plus maintained Keycloak, with separate identity storage, instead
  of borrowing Amar's service or introducing a managed hosted dependency.
- Freeze exact event bytes for retry identity; clients keep outboxes and pull cursors
  independently. Re-encoding bytes with the same answer ID produces 409.
- Keep all writes synthetic-only with no real-data switch and no native adapter.
- Use ephemeral fabricated child profiles for tests only. Native ADULT includes
  teens and is not proof that a learner or account owner is 18+.
- Treat nullability review feedback as a round-trip correctness issue and fix it.

No local execution blocker remains. Real integration/release is deliberately
blocked pending Umar's on-device policy decision; distinct adult/guardian sync
consent; per-learner Arabic trial **18+** eligibility and trial consent; age assurance
review; store/privacy statements; export/deletion/retention reconciliation with
immutable history; TLS, restricted database roles, rate limits, backups and Keycloak
operations; and a separately reviewed native opt-in and history reconciliation
adapter. No compliance or shared Arabic mastery claim is made.

Local follow-up issue: `umarbe-l80` (release policy and real-data lifecycle).
The current Compose uses `start-dev` and bootstrap database roles and must remain
local. All evidence contains fabricated data or aggregate test results only.
