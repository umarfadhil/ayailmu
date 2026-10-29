# Umar native backend (synthetic local prototype)

Separate Go/Postgres/Keycloak backend for the Kotlin AyaIlmu app. Native and Expo
source are unchanged. No Amar services or identity/database state are shared.
**Synthetic fixtures only. Real learner uploads are deliberately unsupported.**

Implemented: migrations + readiness; OIDC access token verification; adult-owner
activation; adult/guardian-owned learners; explicit grant/withdrawal of sync consent;
73 source-pinned packs/rules; immutable native answer history; atomic idempotent
uploads and learner-local cursor downloads. Native scoring/mastery is unchanged.

Read [architecture and API](docs/architecture.md) before integrating a client. The
native app currently has no backend client and says answers stay on-device.

## Start locally

Requires Docker Compose, Python 3, OpenSSL, and Go 1.27+. All data and credentials
created by these instructions belong to the separate synthetic project.

```sh
cd backend-umar
./scripts/init-local.sh
. ./.local/compose.env
docker compose up -d db auth-db auth
./scripts/run-local.sh
```

The API runs as a host binary; `GO=/path/to/go` selects a locally installed toolchain.
On this Mac the task-local toolchain is
`/Users/amarmaruf/Documents/Codex/2026-10-18/task/.runtime/go/bin/go` (Go 1.27.2,
verified against the official download SHA256). Set writable `GOCACHE` and
`GOMODCACHE` if the execution sandbox requires them.

- API: <http://127.0.0.1:8185/healthz>, <http://127.0.0.1:8185/readyz>
- Keycloak: <http://127.0.0.1:8285/admin/> — local admin `umar_local_admin`;
  password is in ignored `.local/admin_password`. Do not copy it into source/chat.
- API DB: `127.0.0.1:6585/umar_native`; credentials in ignored `.local/api.env`.
- Identity DB: internal Compose network only, database `umar_identity`.
- Project: `umar-native-backend`; new volumes `umar_data`, `umar_identity_data`.
  Secrets are created with restrictive file permissions. No real-user accounts.

Keycloak needs several seconds after its database is healthy. `registrationAllowed`
is false. The native public client has authorization code + S256 PKCE enabled;
implicit, password and service-account flows are disabled. The only redirect is a
local test callback. No native client, production redirect or release permission is
added. Existing realms are not overwritten by Keycloak startup imports; after
editing the realm file, use `python3 scripts/configure-local-auth.py` to reconcile
only this local prototype client. The smoke fixture permits Secure cookies solely
for the exact loopback auth address; production clients must use TLS. Login identity is not age proof; the synthetic adult declaration is separate.

Stop the API with Ctrl-C. Stop only this project's services with:

```sh
. ./.local/compose.env
docker compose stop
```

Volumes are retained. Do not run broad Docker cleanup or reset older app databases.

## Verify

Unit tests can run without Postgres; database tests explicitly skip in that mode.
Use the integration script to run **all** tests, without database skips:

```sh
go test ./internal/native ./internal/catalog
./scripts/integration.sh
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
python3 scripts/keycloak-smoke.py
```

`integration.sh` starts a new temporary Postgres cluster on loopback port 16585,
executes `go test -count=1 -race -v ./...`, stops that cluster and removes only its
own temporary directory. On this Mac it uses Postgres.app 16; elsewhere set
`PG_BIN=/directory/with/initdb-and-pg_ctl`. It never uses the persistent app DB.
`scripts/integration-compose.sh` alternatively creates a fresh throwaway test
database inside only this project’s Compose Postgres 17 instance, runs the full
race suite, then removes only that database. The persistent `umar_native` database
is not used for integration tests. The Keycloak smoke test requires the local stack + API and creates a new synthetic
identity in this project's realm. It exercises real code+PKCE login, checks rejection
of an ID token as API bearer, registered trace/story events, byte preservation,
replay receipts and consent withdrawal. It prints no tokens or credentials.

Regenerate registry reproducibly from the pinned **Git object**, not dirty assets:

```sh
python3 scripts/generate_registry.py
```

Registry entries contain metadata and hashes, not published curriculum content.
All 3162 current catalog items remain draft; Arabic contains 17 synthetic items.

## Client contract

Use an API-audience **access token**, never an ID token. Retain provider session
handling in a maintained OIDC client library. The API validates issuer, audience,
RS256 signature, expiry, nbf, issued time, authorized client and `umar.sync` scope.
Account/profile/consent management also requires `auth_time` within five minutes.
Access tokens expire after five minutes; provider logout is not instant revocation
of already-issued bearer tokens. Do not log tokens or payloads.

After adult-owner activation, create a minimal learner mapping, then explicitly
grant `synthetic-sync-v1` consent. A native `ADULT` profile can be a teen; it does
not authorize an account owner. `ANAK` requires an existing same-owner ADULT creator.
Labels, birth years, free-text reports/surveys and drawing coordinates are rejected.
Children's typed responses are rejected even in synthetic tests.

Upload 1–100 frozen payload **strings** in the versioned envelope. Preserve every
native field and the inner `raw_response` JSON string. Same answer ID + exact bytes
returns a duplicate receipt. Any changed bytes return 409 and roll back the whole
batch. Preserve the outbox until 200; a timeout is an uncertain outcome, so retry the
same bytes. Treat 400/403/409 as requiring local resolution; never silently discard.

Keep each learner's pull cursor separately from upload receipts. A POST sequence
is not permission to skip intervening events from another device. Persist a new
pull cursor only after durably storing **all** records in that page. Pull history
must not feed native mastery until a separately reviewed reconciliation contract.
Unknown content/rules/items remain stored as `unregistered`. Registered facts are
validated against source provenance; no server score is inferred.

## Before release

This is a working local slice, not production infrastructure. Real data stays
blocked. Policy/consent/store declarations, age assurance, deletion/export/retention,
TLS, restricted database roles, operational rate limiting, backup/restore, provider
operations and a native opt-in adapter require further work and review. The local
Compose stack uses Keycloak `start-dev` and bootstrap DB roles; do not expose it.
No migration down/delete endpoint is supplied for immutable records.
