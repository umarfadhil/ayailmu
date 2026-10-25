# Supabase PostgreSQL readiness — Umar (AyaIlmu guardian/child backend)

Preparation only. **Nothing here created a Supabase project, role, credential, DNS/TLS record or deployment, and none of
these tools contacted Supabase or any hosted target while this was built or tested.** `migrate --execute` and `verify --execute`
are, by design, able to contact the target a manifest names: they connect only after an owner has recorded the exact approval
and the call repeats the project ref, and they also need `--peer` (the other app's valid manifest) on a Supabase target, so running
either against a real, approved manifest does reach that hosted target. Umar stays synthetic-only (`synthetic boolean CHECK(synthetic)` in the schema; loopback-only
API bind). Design requested by the owner: Supabase **PostgreSQL only**; standalone self-hosted GoTrue and Go API; no hosted
Supabase Auth, no PostgREST/Data API, and no sharing of data models with the adult (Ayangaji) backend.

## Files

| File | Purpose |
|---|---|
| `target.example.json` | Secret-free manifest template. Every open owner decision is a `UNDECIDED:Dnn` sentinel; it can never validate. |
| `supabase_target.py` | Stdlib validator + one-shot wrapper (`validate`, `inventory`, `dsn-check`, `render-env`, `migrate`, `verify`). Byte-identical in the Ayangaji clone (a test enforces this). |
| `sql/umar/owner-bootstrap.sql.template` | **Owner action, unapplied.** Creates the migration and runtime LOGIN roles (no superuser/createdb/createrole/replication/bypassrls; passwords read from private files by psql) and the schema grants. |
| `../../backend-umar/deploy/runtime-grants.sql` | Existing exact runtime grants (reused, unchanged). |
| `sql/umar/hardening.sql.template` | **Owner action, unapplied.** Removes Data-API-role/PUBLIC exposure from `public` objects; no-op where those roles are absent. |
| `sql/umar/verify-readiness.sql` | Read-only catalog checks (`name|t/f`, never data) used by `verify`. |
| `tests/` | Offline validator tests, a real disposable-PostgreSQL lifecycle test, and a cross-app isolation test. |
| `run-tests.sh` | Runs everything. |

## Safety model

* The connection string lives in a private file (owner = you, mode ≤ 0600, outside any git work tree). It is never printed,
  logged, passed in argv, or written elsewhere; tool output is scanned for the password before display. `migrate` hands it
  to the unchanged `cmd/migrate` binary through that process's environment only (Umar has no `_FILE` variant).
* `verify` writes a transient `pgpass` (0600, inside a private 0700 temp directory, removed on exit) so `psql` never receives the
  password in argv or its environment; sessions are forced read-only (`default_transaction_read_only=on`).
* The child process starts with a scrubbed environment (no inherited `PG*`, `UMAR_*`, `AYA_*`, Google/Firebase variables).
* `migrate` and `verify` **default to a dry run that opens no connection**. `--execute` on a Supabase-kind target needs
  `status: owner-approved`, a recorded exact approval string `approved:<project-ref>:migration:<date>` (or `...:verify:...`)
  and `--confirm-project <ref>`. Local throwaway targets (`kind: local-test`) additionally need `--allow-local-test`.
* The validator refuses: example/placeholder/`UNDECIDED` values, transaction pooling (port 6543), non-`verify-full` TLS,
  host/ref/region mismatches, reserved roles (`postgres`, `anon`, `service_role`, `supabase_*`), role-prefix mixes, shared
  migration/runtime roles or secret files, secret paths inside git, a hosted identity placement or any non-`auth` namespace for GoTrue (the supported identity store is a separate self-hosted database), an issuer that is
  not an exact public https origin, and — with `--peer` — any identity shared with the other app's manifest.
* Root CA integrity: the manifest pins the SHA-256 of the Supabase root certificate file; `dsn-check` re-hashes it.

## Commands (all offline unless `--execute`)

```sh
python3 -I infra/supabase/supabase_target.py inventory infra/supabase/target.example.json      # open decisions D01..D18
python3 -I infra/supabase/supabase_target.py validate  /private/umar-target.json [--peer /private/ayangaji-target.json] [--check-files]
python3 -I infra/supabase/supabase_target.py dsn-check /private/umar-target.json --role migration
python3 -I infra/supabase/supabase_target.py render-env /private/umar-target.json --role runtime   # non-secret service env
python3 -I infra/supabase/supabase_target.py migrate   /private/umar-target.json --migrate-bin /private/umar-migrate   # dry run
python3 -I infra/supabase/supabase_target.py verify    /private/umar-target.json --role runtime                         # dry run
```

## Intended order after the owner approves (each step needs its own exact approval; none is performed by this change)

1. Owner decisions D01–D15 (see `inventory`); create the project; record the approval strings in a private manifest.
2. Disable the Data API in the dashboard and download the root CA (D11, D13) — dashboard actions by the owner.
3. Owner runs `owner-bootstrap.sql.template` (roles) with passwords from private files; the migration role gets `CREATE` on
   `public` and nothing else; the runtime role gets nothing yet.
4. `migrate --execute` as the migration role; then the owner applies `runtime-grants.sql` and `hardening.sql.template`.
5. `verify --execute --role migration` and `--role runtime` must report zero failing `must.*` checks.
6. Start the API from a private env built from `render-env` + the runtime DSN, with `UMAR_MIGRATE_ON_START=false`; the API
   itself re-verifies exact migrations, catalog provenance and its own effective privileges and fails closed.

## What the tests prove (and do not)

`./run-tests.sh` (≈1 minute) uses a fresh PostgreSQL 16 cluster under `/tmp` on loopback + a 0700 socket, with TLS from a
throwaway CA and `localhost` as the "remote" name, so the real `verify-full` path runs. It simulates Supabase's Data-API
roles and permissive default ACLs. It proves the tooling, grants, repeatability, fail-closed behavior and isolation of the
real binaries. It does **not** prove anything about Supabase itself (default ACLs, pooler certificates, Supavisor behavior,
the project's PostgreSQL major version, IPv6 reachability).

## Umar-specific blockers (cannot be deployable until resolved)

* **U1 `public` schema is hard-coded** (`search_path` and the runtime privilege check). On Supabase `public` is the schema the
  Data API exposes by default. Mitigation prepared: dedicated migration role (Supabase's default ACLs belong to
  `postgres`/`supabase_admin`, not to it), `hardening.sql.template`, `verify` checks, and the owner disabling the Data API
  (D13). The Supabase-side default ACLs and `public` ownership are unverified until a project exists.
* **U2 The API binds only loopback and has no TLS.** A real staging needs a local TLS-terminating proxy on the same host and a
  co-located GoTrue (JWKS is fetched over `http://127.0.0.1`). Host/platform is undecided (D14).
* **U3 Synthetic-only by schema.** Real learner data is impossible by design; a Supabase target would be synthetic staging.
* **U4 No `UMAR_DATABASE_URL_FILE`.** The runtime password must be in the process environment (use the host's credential
  mechanism with a 0600 environment file). Changing this is an application change, not made here.
* **U5 Identity database topology (resolved, with a real vendor proof).** The pinned GoTrue v2.197.0 migration
  `00_init_auth_schema.up.sql` hard-codes `auth.users`; with `GOTRUE_DB_NAMESPACE=gotrue_probe` against a protected reserved `auth`
  schema it failed with `42501`. A custom namespace on Supabase (a dedicated identity project or a schema in the application
  project) is therefore not a working placement and the validator refuses `dedicated-project` and
  `same-project-dedicated-schema` (`auth-placement-unsupported`). The supported topology is `placement: self-hosted-postgres`:
  a separate self-hosted identity database (`instance_id` + `name`), namespace exactly `auth`, dedicated non-admin `role`.
  Both apps may use `auth` in different identity databases; the same instance and database is refused (`--peer`). Manifests
  carry identifiers only (never an identity DSN) and the wrapper touches only the application database. This was proven against
  the pinned image in the Ayangaji clone; this clone only changed the shared validator and tests. Never point the lab init SQL at a
  hosted `auth` schema.
* **U6** PostgreSQL major: Umar's lab uses 17, local tests here ran 16.3; Supabase's version is D15.
