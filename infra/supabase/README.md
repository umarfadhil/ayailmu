# Supabase PostgreSQL readiness — Ayangaji (adult Arabic app backend)

Preparation only. **Nothing here creates a Supabase project, role, credential, DNS/TLS record or deployment, and no tool
here contacts Supabase.** Owner-requested design: Supabase **PostgreSQL only**; standalone self-hosted GoTrue and Go API;
no hosted Supabase Auth, no PostgREST/Data API, and no merging of the AyaIlmu guardian/child models into this backend.
`production` mode remains refused unless the exact staging opt-in is given; this change does not alter any guard.

## Files

| File | Purpose |
|---|---|
| `target.example.json` | Secret-free manifest template. Every open owner decision is a `UNDECIDED:Dnn` sentinel; it can never validate. |
| `supabase_target.py` | Stdlib validator + one-shot wrapper (`validate`, `inventory`, `dsn-check`, `render-env`, `migrate`, `verify`). Byte-identical in the Umar clone (a test enforces this). |
| `sql/ayangaji/owner-bootstrap.sql.template` | **Owner action, unapplied.** Roles (passwords from private files), database CONNECT/CREATE, schema owned by the migration role, default privileges for the runtime role. |
| `sql/ayangaji/runtime-grants.sql.template` | Idempotent re-assertion of the runtime grants after a migration. |
| `sql/ayangaji/hardening.sql.template` | **Owner action, unapplied.** Removes Data-API-role/PUBLIC exposure from the adult schema; no-op where those roles are absent. |
| `sql/ayangaji/verify-readiness.sql` | Read-only catalog checks used by `verify`. |
| `tests/` | Offline validator tests, real disposable-PostgreSQL lifecycle test (+ real config-loader cross-check), cross-app isolation, and a runner for the adult Go suites that need only PostgreSQL. |
| `../../backend/infra/stagingenv/` | Test-only Go package (build tag `infra_staging`): feeds rendered environments to the real `internal/config` loader. |
| `run-tests.sh` | Runs everything. |

## Safety model

Identical to the Umar clone (including the transient 0600 `pgpass` that `verify` uses instead of argv/env, removed on exit): DSN only in a private file (never printed/argv/logged; output scanned), scrubbed child
environment, **dry run by default**, `--execute` needs `owner-approved` + exact recorded approval + `--confirm-project`,
`verify-full` TLS with a pinned root CA digest, reserved roles/schemas refused (`public`, `auth`, `storage`, `supabase_*`,
`postgres`, `anon`, …), role/secret/issuer/project sharing between apps refused with `--peer`, hosted-`auth` namespace refused
for the identity database. The adult binary reads the DSN through the existing `AYA_DATABASE_URL_FILE` (private-file guard).

## Commands (all offline unless `--execute`)

```sh
python3 -I infra/supabase/supabase_target.py inventory infra/supabase/target.example.json
python3 -I infra/supabase/supabase_target.py validate  /private/ayangaji-target.json [--peer /private/umar-target.json]
python3 -I infra/supabase/supabase_target.py render-env /private/ayangaji-target.json --role runtime   # AYA_MODE=production + staging opt-in env
python3 -I infra/supabase/supabase_target.py migrate   /private/ayangaji-target.json --migrate-bin /private/ayailmu-migrate  # dry run
```

## Actual remote-PostgreSQL support in this source (what is and is not supported)

* `config.Load` refuses `AYA_MODE=production` without `AYA_AUTH_PROVIDER=standalone-gotrue` **and** `AYA_DEPLOYMENT_ENV=staging`.
  With both it takes the deploy-mode database rules: DSN only from `AYA_DATABASE_URL_FILE`, every host (primary and fallbacks)
  must be listed in `AYA_DB_HOSTS`, listen `0.0.0.0:<port>` or IPv4 loopback, public-DNS `AYA_ALLOWED_HOSTS`, at least one https
  `AYA_CORS_ORIGINS`, exact unicast `AYA_TRUSTED_PROXIES`, and Auth at `https://<public name>[:9443]`. `render-env` emits exactly
  that set and the `infra_staging` Go test proves the real loader accepts it and refuses 13 mutations the validator also refuses.
* The migration job (`ayailmu-migrate`) and the API use `store.OpenAllowing` for those modes. Production staging is therefore
  verify TLS for every non-loopback target (A1) and the API refuses an over-privileged database role (A2): both are enforced in
  the application itself, not by this wrapper. Production staging stays blocked by the open owner decisions below (A3–A7).

## Ayangaji-specific blockers

* **A1 (resolved in the core) remote database transport.** `store.OpenAllowing`/`ParseConfigAllowing` now apply the rule to what pgx
  actually parsed (URL, `PG*` environment and service file; primary and every fallback): a literal loopback IP or Unix socket is
  local, every other target needs `sslmode=verify-full` (server name = dialed host, no skip-verify, no plaintext fallback).
  `disable`, `allow`, `prefer`, `require` and `verify-ca` are refused with a generic message before any byte is sent. One explicit
  exception exists, `AYA_DB_TRANSPORT=private-network` (used only by the local Compose stack): `sslmode=disable` to a single-label
  name or an RFC 1918/ULA address; production refuses the setting and no public DNS name or address ever qualifies.
  Regression tests: `test_adult_store_refuses_plaintext_*` and `test_adult_store_private_network_exception_*` here, plus
  `internal/store/transport_test.go`, `internal/config/dbtransport_test.go` and the migrate binary's `transport_test.go`.
* **A2 (resolved in the core) runtime privilege self-check.** In every deploy mode and production the API calls
  `store.VerifyRuntimePrivileges` after `VerifySchema` and refuses to serve (generic errors) as a superuser or schema/table owner,
  a role with CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS, one that belongs to or acts as another role, one that can CREATE in the
  schema, `public` or the database, one holding TRUNCATE/TRIGGER/REFERENCES or any grant option on an app table, one with any write
  right on `schema_migrations`, or one missing a right the service uses. The adult runtime legitimately needs UPDATE/DELETE
  (account erasure, ledger replay): the exact matrix is `store.runtimeRights`, proven by running every store operation as a role
  holding exactly it. `Migrate` also strips write rights on `schema_migrations` from non-owners, and `runtime-grants.sql.template`
  and `verify-readiness.sql` now match this (the latter tests each required right alone, because a comma list means ANY).
  Tests: `test_api_refuses_*` here (against the real binaries) and `internal/store/runtime_test.go`.
* **A3 Migration role needs `CREATE` on the database** (`CREATE SCHEMA IF NOT EXISTS` checks it before the existence test; verified
  by `test_12`). On Supabase that is a grant on database `postgres`: residual privilege for the migration role only.
* **A4 Staging prerequisites are all open decisions:** public API/Auth DNS names, TLS termination and the private `:9443` Auth
  listener, trusted proxy addresses, at least one web CORS origin (production refuses native-only), the GoTrue admin credential.
* **A5 The existing `deploy/` stack is local synthetic Docker Compose and was not changed.** There is no staging runtime
  packaging, no restore path for Supabase backups, and the restore drill (`deploy/restore`) targets the local Compose stack.
* **A6 Schema name:** the code default is `ayailmu` (legacy brand of the repo). Renaming after data exists is a data migration (D17).
* **A7 GoTrue on Supabase PostgreSQL is untested** (same as Umar U5): needs a non-`auth` namespace proof with the pinned image.

## Tests

`./run-tests.sh` (≈2 minutes): offline validator tests; lifecycle on a fresh disposable PostgreSQL 16 cluster with TLS (real
`ayailmu-migrate` and `ayailmu-api` in `deploy-smoke` mode); the config-loader cross-check; the adult Go suites that need only
PostgreSQL (`tests/run_adult_go_suites.py`); and cross-app isolation. **Not run here:** the 6 tests that need the pinned real GoTrue
fixture (Docker; see `infra/real-auth/`) and the curriculum registry-pin test, which needs the archived pinned fixtures
(see `infra/catalog/`) — all excluded by name and printed, not silently skipped.
