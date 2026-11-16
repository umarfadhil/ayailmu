# AyaIlmu backend (backend-umar)

Go/Postgres API for the AyaIlmu app. Auth is GoTrue (ES256 tokens, one public origin for API and
Auth). The server runs only in `UMAR_DATA_MODE=NORMAL_ONLY` with `UMAR_AUTH_PROVIDER=gotrue`, and refuses
to start otherwise.

Implemented: migrations + readiness; GoTrue access token verification; adult-owner activation;
adult/guardian-owned learners; explicit grant/withdrawal of sync consent; source-pinned packs/rules;
immutable native answer history; atomic idempotent uploads and learner-local cursor downloads;
account erasure through GoTrue's admin API.

Read [architecture and API](docs/architecture.md) before integrating a client. Hosting (Cloudflare
Containers + Neon + Brevo) lives outside this repo, in the aya-hosting folder.

## Verify

Unit tests can run without Postgres; database tests explicitly skip in that mode.
Use the integration script to run **all** tests, without database skips:

```sh
./scripts/integration.sh
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

`integration.sh` starts a new temporary Postgres cluster on loopback port 16585, executes
`go test -count=1 -race -v ./...`, stops that cluster and removes only its own temporary directory.
On this Mac it uses Postgres.app 16; elsewhere set `PG_BIN=/directory/with/initdb-and-pg_ctl`.
`GO=/path/to/go` selects a toolchain. The tests use an in-process fixture token issuer
(`internal/testoidc`), never a real identity provider.

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

Live on Cloudflare Containers + Neon since 2026-11-15 (see the aya-hosting folder). Release
readiness (`UMAR_NORMAL_RELEASE_READY`) stays false until the reviewed content registry exists; until
then the API refuses account activation and serves no packs. No migration down/delete endpoint is
supplied for immutable records.
