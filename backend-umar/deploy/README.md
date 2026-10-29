# Restricted runtime preparation

This is a synthetic-only backend. These files neither deploy it nor configure real accounts,
credentials or roles. Real-user consent, content, export/deletion/retention and operational
decisions remain unresolved. The [current checkpoint](../../docs/integration/2026-10-22-endpoint-and-runtime-isolation.md)
describes the boundary and verification.

Local launch still defaults to automatic migrations. An approved deployment can separate a
short-lived migration identity from an existing restricted runtime identity:

1. Build `go build -o /approved/private/path/umar-migrate ./cmd/migrate` and
   `go build -o /approved/private/path/umar-api ./cmd/server`. The migration executable starts no
   HTTP listener and does not require provider credentials.
2. In the approved isolated target, run the migration executable with `UMAR_DATABASE_URL`
   supplied privately for the migration identity. Never pass connection secrets on a visible
   command line, commit them or copy a real database into tests. Migrations retain checksum
   checks and immutable event/consent/pack triggers.
3. Have the database owner review `runtime-grants.sql` for an **already approved** non-owner
   runtime role. The template creates no role, password, membership or login and grants no
   DELETE, TRUNCATE, schema CREATE or account UPDATE. It grants only learner sequence UPDATE;
   other writes are INSERT. It intentionally does not revoke unrelated inherited grants or
   alter PUBLIC/database ownership on an existing server.
4. Start the API with that runtime connection and `UMAR_MIGRATE_ON_START=false`.
   `synthetic-runtime.env.example` contains public placeholders only. Startup reads schema and
   catalog in a repeatable-read, read-only transaction, rejects missing/changed/newer migration
   manifests and mismatched catalog metadata, then checks effective runtime privileges.
   Missing privileges, schema/database CREATE, owning-role access, admin role attributes,
   DELETE/TRUNCATE/TRIGGER, disallowed INSERT or column UPDATE all fail closed. Errors logged
   by the executables are generic; connection strings and provider material are not logged.

## Remote PostgreSQL transport

`store.Open` validates the parsed pgx main target and every fallback before creating a pool. Every
remote target must use `sslmode=verify-full`; the default, `disable`, `prefer`, `allow`, `require`
and `verify-ca` are rejected because they permit plaintext or omit hostname verification. A remote
fallback cannot downgrade an otherwise verified main target. Only literal loopback IP addresses
and local Unix socket destinations retain the non-TLS synthetic-test defaults. DNS names are not
classified as loopback.

For a remote deployment, configure a trusted root as well as `sslmode=verify-full`: use
`sslrootcert=system` for an approved publicly trusted chain, or an approved private root
certificate file. The server certificate chain must validate to that root and its SAN must match
the exact configured host. Keep the root file private to the deployment, protect its integrity,
and do not substitute `require` or `verify-ca` when certificate validation fails.

Actual Supabase PostgreSQL use still requires owner approval of the direct or pooler choice, every
main/fallback host and port, DNS and certificate SAN match, trusted root chain, network route, and
the separately approved migration/runtime identities. This source validation does not approve or
configure those inputs; no Supabase project was contacted.

An invalid migration setting fails startup; there is no permissive typo fallback. The connection
search path is fixed to `public, pg_temp` so caller-configured writable schemas or temporary
tables cannot shadow application tables. Idempotent account activation uses INSERT plus a
read-committed lookup; profile creation serializes by an account-scoped transaction advisory
lock without needing account UPDATE rights.

The API still enforces each authenticated owner's learner access in its queries. One runtime
role can read all application rows for those operations; this is **not Postgres row-level
security or protection against a fully compromised API**. Provisioning/membership policies,
credential rotation, network TLS, auth DB permissions, monitoring, backups and operational
ownership require a separately approved deployment. No existing Mac database/role is changed
by committing this template.

Before rollout, run migrations/grants privately, start a canary with the restricted connection,
verify readiness and fabricated lifecycle/replay/isolation, then perform the approved traffic
switch. For rollback stop the canary and restore the prior binary/config only if schema-compatible.
The exact migration-manifest check deliberately refuses a newer schema; reverting Git is not a
database rollback. Restore into a new isolated database before any destructive recovery.
