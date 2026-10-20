# Plan: Cloud Run + self-hosted GoTrue release preparation, slice 1 (local preflight packet)

**Goal:** a local, reviewable, non-applying preflight that checks the owner's non-secret deployment inputs for the
selected topology and writes a packet that lists everything still unverified.
**Architecture:** one standard-library Python script under `deploy/cloudrun/`, run by hand, reading one explicit JSON
input and writing one JSON result. **Tech:** Python 3.10+ standard library only; `unittest`.

**Status (2026-10-20): RED and GREEN independently verified by Codex, including a final run after the documentation
and gate-text follow-ups. The last prose review (§H corrections) is separate from, and proves nothing about, hosted or
runtime behaviour.**
- Codex ran the RED suite: 53 expected failures, zero errors, all because the tool did not exist yet.
- Codex then ran the GREEN suite against the authored tool and example: all 53 frozen tests pass (11.331 s, exit 0).
- Codex's final run, after the follow-ups: 53 of 53 pass (11.493 s). The test file's SHA256 is still
  `9d92bdc15c91142ccc98ae09e860f3cabe6a0ff0227963762c19e2b57cbe2c19`, the tool source's SHA256 is
  `9dcac33308494873d4162d04daff676625674d26a83de016ac3257da5448e4a5`, and all tracked Go, RN and deploy sources are
  unchanged.
- Branch `feature/cloud-run-gotrue-prep-20261020`, from `37758c193d570df391bc339683133c254024db67`. Commit, push and
  pull request are authorized separately by the owner; this document performs none of them.
- The tool creates nothing. The dedicated unbilled project below was created separately, by hand in a signed-in
  browser. There is no billing link, chargeable resource, credential, API enablement, OAuth grant or deployment. No
  hosted database is contacted and no SQL runs.
- No change to the Go API, the RN app, the existing deploy tooling, or any frozen test or helper.
- Every host in the tests and the example is a documentation name (RFC 2606: `example.com`, `.net`, `.org`), and every
  secret is a reference name. Nothing is a credential.

## Selected topology (owner decision, 2026-10-20)
- Cloud Run service 1 runs the existing Go API. Cloud Run service 2 runs upstream GoTrue v2.197.0, pinned by digest.
- Supabase provides hosted PostgreSQL only, with separate app and Auth schemas and roles.
- No managed Supabase Auth, no Supabase-only rewrite and no merged container.
- min instances 0 by default, with bounded max instances and pools. That is not a zero-cost guarantee.
- Authorization today:
  - Local preparation, including this slice, is authorized.
  - A dedicated, unbilled GCP project has been created, and its owner is approved for now (snapshot below). The owner
    intends to move to a proper GCP account later (§H).
  - Billing linkage, paid resources, credential creation, API enablement, OAuth grants, new access grants and live
    deployment are not approved.

### Cloud project snapshot (2026-10-20, created and inspected by Codex in the owner's signed-in browser)
| Item | Observed |
|---|---|
| Name | Amar Arabic App |
| Project ID | `amar-arabic-20261020` |
| Project number | `190266404338` |
| Organization | none |
| Owner | IAM row `amarmarf@gmail.com`, role Owner; the signed-in account's identity was verified before creation |
| Billing | the billing page says the project has no billing account and is not linked |
| Not done | billing, any chargeable resource, any credential, any API enablement, any deployment, any new access grant |
| Supabase | the GitHub sign-in reached GitHub's credential screen and stopped. The owner's handoff is pending. No Supabase identity or project is verified, and no grant has been accepted |

This snapshot is a record, not a product input. The tool, its example, the tests and every product source name no
project or account.

## A. Constraints taken from the source
| Fact | Source | Consequence for this slice |
|---|---|---|
| Production accepts only `AYA_AUTH_PROVIDER=standalone-gotrue` with `AYA_DEPLOYMENT_ENV=staging`, and Auth at an https root by public name | `backend/internal/config/production_staging.go:10-16,29-33,50-80` | The packet targets a self-hosted Auth root. A production deployment profile is a gate (§E). |
| Public names exclude localhost, local, test, invalid, example, onion, alt, arpa, internal, intranet, private, corp, home, lan and localdomain; RN also forbids any port | `production_staging.go:42-48,106-116`; RN `app/src/account/staging.ts:20-38` | Origins follow the stricter union of both rules (§B.4). |
| Admission trusts only exact proxy IP literals | `backend/internal/httpapi/admission.go:23-40` | Gate; no Cloud Run profile exists. |
| Secret files must be owned by the process user, with no group or other access | `backend/internal/config/config.go:383-421` | Gate; Cloud Run secret mounts are not adapted. |
| The pgx pool sends `search_path` and `default_transaction_isolation` as connection parameters and uses prepared, batched queries; no code enforces a TLS mode | `backend/internal/store/store.go:44-77`, `backend/internal/store/events.go:337-364` | The input must name a direct or session-mode endpoint and `verify-full`. Transaction pooling is refused. The TLS/session-setting assertion in code is a gate. |
| Schema names: a lowercase identifier of at most 63 bytes, not `public`, `information_schema` or `pg_*` | `backend/internal/store/store.go:169-183` | The same rule, plus Supabase's reserved names. |
| Local roles: owner (migrates), runtime (DML only), backup (reads, BYPASSRLS) and Auth owner (GoTrue migrates and runs as it), created by a superuser bootstrap | `deploy/postgres/initdb/10-aya-roles.sql:1-65` | The same role design. That bootstrap is not portable to a hosted, non-superuser `postgres` and is not supplied (§C). |
| GoTrue is pinned as `docker.io/supabase/gotrue:v2.197.0@sha256:1736a630…12c6b` | `deploy/compose.yaml:20`, `deploy/tools/aya_stack.py:83` | The packet repeats exactly this reference. No override and no `latest`. Its linux/amd64 availability is a gate. |
| GoTrue migrations qualify every object with the namespace. `DB_NAMESPACE` defaults to `auth`. `GOTRUE_DB_MAX_POOL_SIZE` 0 means unlimited | GoTrue v2.197.0 (archive sha256 `d21291c2…1d461d`, review copy outside the repo): `migrations/*` (75 files), `internal/conf/configuration.go:118-134`, `README.md:274-280` | Namespace `aya_auth` by default. The Auth pool must be at least 1. Static review found more (next row), so the Auth role and connection `search_path` matter. Runtime use of a non-`auth` namespace is a gate: no hosted runtime or migration has been executed. |
| Static review of the migrator and model code: `cmd/migrate_cmd.go:64` passes `DB.Namespace` into the migration templates, and `internal/models/user.go:139` returns unqualified `users` | GoTrue v2.197.0 (same review copy): `cmd/migrate_cmd.go:64`, `internal/models/user.go:139` | This is static evidence only. The Auth role's `search_path` must resolve to the Auth schema (§C). Whether a custom namespace works at runtime is not verified; that stays a gate (§E). |
| Migration `20240612123726` enables row-level security on 16 Auth tables and gives `postgres` SELECT WITH GRANT OPTION on them | GoTrue `migrations/20240612123726_enable_rls_update_grants.up.sql:3-35` | The project admin can read Auth data and grant it onward. A backup role that doesn't own those tables needs BYPASSRLS, whose hosted grantability is unverified, or Auth is dumped as its owner. This is a gate (§C). |
| GoTrue requires `JWT_SECRET` even with asymmetric `JWT_KEYS` | GoTrue `internal/conf/configuration.go:145-157` | The packet has a secret slot for each. Durable key ownership and rotation are reviewed requirements, never generated. |

## B. Tool contract (GREEN implements exactly this)

### B.1 Files
- `deploy/cloudrun/aya_cloudrun_packet.py`: the script. Standard library only.
- `deploy/cloudrun/example-input.json`: the labelled example (`"example": true`), using documentation names only.
- `deploy/cloudrun/tests/test_aya_cloudrun_packet.py`: this slice's tests, frozen.

### B.2 Invocation
```
python3 -I -B deploy/cloudrun/aya_cloudrun_packet.py check INPUT
python3 -I -B deploy/cloudrun/aya_cloudrun_packet.py packet INPUT OUTPUT
```
- **INPUT** is an explicit path to a regular file, or `-` for standard input.
  - A symlink, directory or other file type is refused.
  - At most 65,536 bytes, UTF-8.
  - No other file is read.
- **OUTPUT** (for `packet` only) is a new path.
  - It is created exclusively, with mode 0600, and never overwritten.
  - An existing path or symlink, dangling or not, is refused. The parent directory must exist.
  - OUTPUT is checked before the configuration is evaluated, and written only when the configuration is valid.
- There is no other command, no option and no default action.
  - Nothing is applied, provisioned, executed or sent.
  - No environment variable, metadata service, account or network is consulted.

### B.3 Exit status and output
- **0:** the configuration is valid. This never means ready to deploy.
- **1:** the configuration is invalid; `packet` writes nothing.
- **2:** not evaluated, because of a usage, input, parse, format or output problem.

Every invocation writes exactly one JSON document to standard output, followed by a newline:
- printable ASCII only (anything else is escaped);
- deterministic, so identical input gives identical bytes;
- findings sorted by field, then by code.

Standard error never carries an input value. `packet` writes the same document to OUTPUT.

| Result member | Value |
|---|---|
| `format` | `"ayailmu-cloudrun-result/1"` |
| `command` | `"check"`, `"packet"`, or `null` for a usage error |
| `input_sha256` | hex SHA-256 of the exact input bytes, or `null` when no input was read |
| `error` | `null`, or `{"code": <error code>}` when the exit status is 2 |
| `configuration` | `null` when the exit status is 2; otherwise `{"valid": bool, "example": bool, "findings": [{"code", "field"}]}` |
| `deployment_ready`, `applies_changes`, `creates_resources`, `hosted_compatibility_verified`, `zero_cost_guaranteed` | always `false` |
| `gates` | always every gate of §E: `{"id", "status": "outstanding", "summary", "sources": [str]}` |
| `packet` | `null` unless the configuration is valid; then §B.6 |

**Findings** carry a dotted field path and a code; a fixed `message` per code may be added. They never quote a value. An unknown member's name appears in the path only if it matches `^[a-z][a-z0-9_]{0,31}$`; otherwise the path shows `<member>`.

**Error codes (exit 2):**
- `usage`
- `input_unreadable`, `input_not_regular_file`, `input_too_large`, `input_not_utf8`
- `invalid_json`: empty input, syntax errors, trailing data, `NaN`, `Infinity`
- `duplicate_member`: at any depth
- `not_an_object`
- `unsupported_format`: `format` missing or not exactly the input format
- `output_exists`, `output_unwritable`

### B.4 Input document (closed: any unknown member is refused)
| Member | JSON type | Rule |
|---|---|---|
| `format` | string | exactly `"ayailmu-cloudrun-input/1"` |
| `example` | boolean | required. `true` also allows documentation names; `false` refuses them (`placeholder_host`) |
| `api.origin` | string | canonical origin (below) |
| `api.min_instances` | integer | optional, default 0; 0 to `api.max_instances` |
| `api.max_instances` | integer | 1–10 |
| `api.db_pool_max_conns` | integer | 1–20 |
| `auth.origin` | string | canonical origin; must differ from `api.origin` |
| `auth.issuer` | string | optional, default `auth.origin`; canonical origin. Permanent, because accounts are keyed by issuer (`backend/internal/store/migrations/0001_init.sql:10`) |
| `auth.min_instances`, `auth.max_instances` | integer | as for the API |
| `auth.db_pool_max_size` | integer | 1–20. 0 means unlimited in GoTrue, so it is refused (`unbounded_pool`) |
| `auth.google_enabled` | boolean | optional, default `false` |
| `database.host` | string | the host exactly as copied from the provider |
| `database.port` | integer | 1–65535 |
| `database.connection_mode` | string | `direct` or `session` |
| `database.tls_mode` | string | exactly `verify-full` |
| `database.connection_limit` | integer | 1–10000, the plan's limit as read by the owner |
| `database.migration_connections`, `backup_connections`, `headroom_connections` | integer | 1–100 each |
| `schemas.app`, `schemas.auth` | string | optional; defaults `ayailmu`, `aya_auth` |
| `roles.app_owner`, `app_runtime`, `auth_owner`, `backup` | string | optional; defaults `aya_owner`, `aya_runtime`, `aya_auth_owner`, `aya_backup` |
| `secret_references.<slot>` | object | `{"secret": <name>, "version": <pinned version>}` (§B.5) |

**Integers** are JSON integers only; booleans and floats are refused.

**Missing, wrong-type and unknown members:**
- A missing required member gives `missing_field`; a wrong JSON type gives `invalid_type`.
- An unknown member gives `unknown_field`, unless its name looks like a secret, which gives `secret_field_refused` first.
- A name looks like a secret when, lowercased, it contains `password`, `passwd`, `secret`, `token`, `private`, `apikey`, `credential`, `jwk`, `dsn`, `database_url`, `connection_string` or `conninfo`, or has `pass`, `key` or `keys` as an underscore-separated word.
- The only exceptions are the member `secret_references`, its slot names and a reference's `secret` member.

**Canonical origin:** `https://` followed by a host, and nothing else.
- The host is two or more dot-separated labels of `[a-z0-9]` with inner hyphens, each 1–63 characters. The last label starts with a letter, and the whole host is at most 253 characters. Anything else is `invalid_origin`: another scheme or case, a port, a path (including `/` and `/auth/v1`), userinfo, a query, a fragment, a wildcard, an IP literal, whitespace, control characters, template or shell text.
- A last label in §A's non-public set is `non_public_host`.
- `supabase.co`, `supabase.com` or any subdomain of either, used as API origin, Auth origin or issuer, is `managed_supabase_host`. This topology hosts its own GoTrue.
- A documentation name when `example` is `false` is `placeholder_host`.
- `auth.origin` equal to `api.origin` is `origin_collision`, reported on `auth.origin`.

**Database host:** the same host syntax with no scheme, port, path or userinfo; anything else is `invalid_host`.
- A non-public last label is `non_public_host`.
- A documentation name outside an example is `placeholder_host`.
- Provider host names (for example Supabase's direct or pooler hosts) are allowed here.

**Connection mode and TLS:**
- `transaction` is `transaction_pooling_unsupported`. Any other value except `direct` or `session` is `invalid_connection_mode`.
- Any TLS mode other than `verify-full` is `tls_not_verify_full`.

**Ranges:**
- Out-of-range numbers are `out_of_range`.
- `min_instances` above `max_instances` is `min_exceeds_max`, on the `min_instances` member.
- The connection budget (§D) over `database.connection_limit` is `connection_budget_exceeded`, on `database.connection_limit`.

**Identifiers** (schemas and roles) must match `^[a-z][a-z0-9_]{0,62}$`; anything else is `invalid_identifier`.
- **Reserved schemas** (`reserved_schema`): `public`, `information_schema`, `auth`, `storage`, `realtime`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `vault`, `net`, `cron`, `pgsodium`, `pgsodium_masks`, and any name starting with `pg_` or `supabase`.
- **Reserved roles** (`reserved_role`): `postgres`, `public`, `anon`, `authenticated`, `service_role`, `authenticator`, `dashboard_user`, `pgbouncer`, and any name starting with `pg_`, `pgsodium` or `supabase`. The prefix rule covers `supabase_admin` and `supabase_auth_admin`.
- **Collisions:**
  - `schemas.auth` equal to `schemas.app` is `schema_collision`, on `schemas.auth`.
  - Two equal roles are `role_collision`, on the later role. Order: `app_owner`, `app_runtime`, `auth_owner`, `backup`.
- The input carries no role attributes, grants or privileges; such members are unknown.

### B.5 Secret slots (references only; a value never enters or leaves the tool)
| Slot (in this order) | The secret it names (never in the input) | Consumer, by its verified setting name |
|---|---|---|
| `api_database_url` | runtime DSN of `roles.app_runtime`, with `sslmode=verify-full`, `sslrootcert` and `pool_max_conns` | API `AYA_DATABASE_URL_FILE` |
| `api_auth_admin_credential` | GoTrue admin credential, used for identity deletion | API `AYA_SUPABASE_ADMIN_KEY_FILE` |
| `migration_database_url` | DSN of `roles.app_owner` | migration job `AYA_DATABASE_URL_FILE` |
| `auth_database_url` | DSN of `roles.auth_owner` | GoTrue `DATABASE_URL` |
| `auth_jwt_keys` | durable ES256 private key set | GoTrue `GOTRUE_JWT_KEYS` |
| `auth_jwt_secret` | the JWT secret GoTrue requires | GoTrue `GOTRUE_JWT_SECRET` |
| `auth_smtp_password` | the SMTP password | GoTrue `GOTRUE_SMTP_PASS` |
| `database_root_ca` | the provider's CA certificate (public, delivered as a file) | `sslrootcert` of every DSN |
| `auth_google_client_secret` | Google OAuth client secret. Required when `auth.google_enabled` is true; otherwise its presence is `unused_secret_reference` | GoTrue `GOTRUE_EXTERNAL_GOOGLE_SECRET` (the README's per-provider pattern) |

**Reference format:**
- `secret` is a Secret Manager secret name for this app, matching `^aya-[a-z0-9]+(-[a-z0-9]+)*$`, at most 63 characters.
- `version` is a pinned decimal string matching `^[1-9][0-9]{0,9}$`.
- `"latest"` is `unpinned_secret_version`. Any other malformed reference is `invalid_secret_reference`: not an object, a missing, extra or wrongly typed member, or a bad pattern.
- Each is reported on the slot path.

**Slot rules:**
- A required slot without a reference is `missing_secret_reference`.
- A secret name used by two slots, whatever their versions, is `secret_reference_reused`, on the later slot.
- An unknown slot is `unknown_field`.
- The project ID is not an input: the packet names no account or project.

### B.6 Packet (present only when the configuration is valid)
```
{"non_executable": true, "example": <input example>,
 "topology": "api-and-gotrue-on-cloud-run-with-supabase-postgres",
 "services": {
   "api":  {"origin", "image": null, "min_instances", "max_instances", "db_pool_max_conns"},
   "auth": {"origin", "issuer", "audience": "authenticated", "image": <the deploy/compose.yaml:20 reference>,
            "min_instances", "max_instances", "db_pool_max_size", "google_enabled",
            "google_callback": "<auth.origin>/callback" or null}},
 "database": {"host", "port", "connection_mode", "tls_mode", "schemas": {"app", "auth"},
              "roles": {"app_owner", "app_runtime", "auth_owner", "backup"},
              "connection_budget": {"api", "auth", "migration", "backup", "headroom", "total", "limit"}},
 "secret_references": {<slot>: {"secret", "version"}}}
```
- `services.api.image` stays `null`, because no linux/amd64 API image of the current revision exists (§E).
- The packet contains no SQL, no environment file, no manifest and no command.

## C. Hosted database design (descriptive only; no SQL in this slice)
**Layout:** one database, the Supabase project's own, with two custom schemas that no Supabase component uses.
- `schemas.app` is owned by `roles.app_owner`, which only the migration job uses.
- `roles.app_runtime` gets DML on the app tables through default privileges. No DDL and no TEMP.
- `schemas.auth` is owned by `roles.auth_owner`. GoTrue migrates at startup (GoTrue `README.md:284-287`), so this one role both migrates and runs; its `search_path` is its own schema, as `10-aya-roles.sql:46` sets it locally. Static review of GoTrue v2.197.0 shows the namespace reaching the migration templates while the user model returns unqualified `users` (§A), so this setting on the role and the connection is what makes the Auth tables resolve.
- `roles.backup` reads both schemas.
- None of the roles is a superuser. None may create roles or databases, replicate, or inherit.

**Never touched:**
- Supabase's reserved schemas, especially `auth`, and `supabase_auth_admin`.
- Our roles get nothing on `auth`, so a hard-coded reference fails instead of writing there.
- Both custom schemas stay outside the Data API's exposed schemas, with no grant to `PUBLIC`, `anon`, `authenticated` or `service_role`.

**Consequences of migration `20240612123726`:**
- The project's `postgres` credential can read Auth tables and grant that onward; treat it as top-tier.
- A non-owner backup needs BYPASSRLS, so either dump Auth as `roles.auth_owner` or rely on platform backups.

**Outstanding:** whether hosted `postgres` can create these roles and schemas, grant these attributes and set default privileges, and whether both migration sets and the GoTrue runtime work under these names. This is checked only in a disposable hosted project after authorization (gates in §E). The local bootstrap `10-aya-roles.sql` runs as a superuser and is not portable as is.

## D. Connection budget
`total = api.max_instances × api.db_pool_max_conns + auth.max_instances × auth.db_pool_max_size
+ migration_connections + backup_connections + headroom_connections`, and it must not exceed
`database.connection_limit`.
- Every instance may open its whole pool, so max instances multiply.
- Headroom covers the provider's own services and the operator.
- The limit is the owner's reading of the plan; the tool cannot verify it.

## E. Gates (every result lists all of them, always `outstanding`; no summary contains SQL)
| id | summary | sources |
|---|---|---|
| `api-cloud-run-proxy-admission` | Production admits requests only from exact trusted proxy IP literals; Cloud Run has no such profile in code | `backend/internal/httpapi/admission.go:23-40`, `backend/internal/config/production_staging.go:22-24` |
| `api-secret-file-mounts` | Secret files must be owned by the process user with no group or other access; Cloud Run mounts are not adapted | `backend/internal/config/config.go:383-421` |
| `api-database-tls-and-session-settings` | Nothing requires `verify-full`; startup does not assert `search_path` or `default_transaction_isolation` | `backend/internal/store/store.go:44-77` |
| `api-production-deployment-profile` | The only deployment value is `staging`, and production requires non-empty web origins | `backend/internal/config/production_staging.go:29-33,50-53`, `backend/internal/config/deploy.go:152-161` |
| `api-amd64-provenance-build` | No linux/amd64 API image of the current revision exists, and the running binary records no revision | `deploy/api/Dockerfile`, phase22 runtime report (outside the repository) |
| `gotrue-image-platform` | The pinned GoTrue digest was used only on the local arm64 Compose stack; its linux/amd64 availability is unverified | `deploy/compose.yaml:20` |
| `hosted-database-permissions-and-migrations` | Hosted `postgres` is not a superuser. These roles, schemas, grants and default privileges, Data API exclusion and both migration sets are untested on a disposable hosted project | `deploy/postgres/initdb/10-aya-roles.sql:1-65` |
| `gotrue-postgres-grant-and-rls` | Migration 20240612123726 enables row-level security on Auth tables and gives `postgres` SELECT WITH GRANT OPTION; a non-owner backup needs BYPASSRLS | GoTrue `migrations/20240612123726_enable_rls_update_grants.up.sql:3-35`, `deploy/postgres/initdb/10-aya-roles.sql:8-9,24` |
| `gotrue-namespace-runtime` | Static review of pinned GoTrue v2.197.0 shows `cmd/migrate_cmd.go:64` passing `DB.Namespace` into the migration templates and `internal/models/user.go:139` returning unqualified `users`, so the Auth role and connection `search_path` matter. No hosted runtime or migration has been executed; behaviour under a custom namespace remains to be verified on a disposable hosted project | GoTrue `cmd/migrate_cmd.go:64`, GoTrue `internal/models/user.go:139`, GoTrue `internal/conf/configuration.go:121`, GoTrue `README.md:278-280` |
| `gotrue-keys-and-admin-credential` | The durable ES256 key set, the required JWT secret and a bounded admin credential need an owner, custody and rotation | GoTrue `internal/conf/configuration.go:145-157`, `deploy/README.md:227` |
| `smtp-delivery` | Sender domain with SPF, DKIM and DMARC; verification, resend and reset links; proof of delivery | GoTrue `README.md:516-552`, `deploy/compose.yaml:122-146` |
| `client-account-flows` | The app accepts only `.test` password accounts, keeps sessions in memory and has no export or deletion screen | RN `app/src/auth/supabaseAuth.ts:347-353,632-633`, RN `app/src/app/settings.tsx:132` |
| `oauth-only-reauth` | Recent sign-in comes only from a password sign-in, so a Google-only account cannot export or delete | `backend/internal/authn/supabase.go:327-333`, `backend/internal/httpapi/account.go:111-121` |
| `native-builds-and-callbacks` | Signed iOS and Android builds, app IDs, the native callback and Google registration; Expo Go proves no OAuth | RN `app/app.json:9-33`, RN `app/src/auth/googleDevice.ts:14` |
| `reviewed-content` | The active content pack is synthetic, with every item and screen in draft | RN `app/src/content/fixtures/demo-v0.3.json:4`, RN `app/src/content/gating.ts:23-26` |
| `operations` | Scheduled off-instance backups, a restore rehearsal with deletion-ledger replay before exposure, retention, monitoring, alerts and rate limits | `backend/cmd/ayailmu-ledger/main.go:1-40`, `backend/internal/store/migrations/0002_account_deletion.sql:1-4` |
| `cost-and-resource-approval` | The owner decision record holds a dedicated unbilled project and its verified owner. Billing linkage, paid resources, credential creation, API enablement, OAuth grants, new access grants and live deployment are not approved. Min instances 0 bills by use and promises no zero cost | owner decision record, this plan's Cloud project snapshot |

RN paths are in the RN repository (`ayailmu-rn-ux-20261017`). GoTrue paths are in the reviewed v2.197.0 copy.

## F. Tasks

### Slice 1 RED (complete)
- [x] Write this plan.
- [x] Write `deploy/cloudrun/tests/test_aya_cloudrun_packet.py`: 53 tests in 12 classes. It runs the tool as its own process with only `PATH` in its environment, never imports it, and covers:
  - the result contract and the never-ready claims;
  - the command line, standard input and parse errors;
  - the input's shape;
  - origins, the database, the budget, identifiers, secret references and secret values;
  - the packet file;
  - source safety and no execution;
  - the shipped example.
- [x] Codex ran, from the worktree root:
  `python3 -I -B -m unittest discover -s deploy/cloudrun/tests -p 'test_*.py' -v`
  Result: `FAILED (failures=53)`, zero errors, no passes. Every test failed in `setUp` with
  "deploy/cloudrun/aya_cloudrun_packet.py does not exist yet: the GREEN slice adds it".

### Slice 1 GREEN (authored and independently verified)
- [x] Add `deploy/cloudrun/aya_cloudrun_packet.py` exactly per §B–§E: standard library only, deterministic, no network, no subprocess, no dynamic code, no environment access.
- [x] Add `deploy/cloudrun/example-input.json`, with `"example": true`, documentation names and reference names only.
- [x] Leave every test unedited. A needed test change goes back to review first.
- [x] Independent verification by Codex: all 53 frozen tests pass (11.331 s, exit 0), the test file's SHA256 is unchanged, and all tracked Go, RN and deploy sources are unchanged.
- [x] Independent final verification by Codex after the follow-ups: 53 of 53 pass (11.493 s), the frozen tests are unchanged, the tool source SHA256 is `9dcac33308494873d4162d04daff676625674d26a83de016ac3257da5448e4a5`, and tracked Go, RN and deploy sources are still unchanged.
- [x] Add no other file:
  - no change to the Go API, the RN app, existing deploy tooling or any frozen test or helper;
  - no SQL, manifest, environment file or README in this slice.
- [x] The documentation-only follow-up (project snapshot, gate wording, §H) changed this plan and the
  `cost-and-resource-approval` gate text only, with no behaviour, schema or output-contract change. Codex's final run
  above covers it.
- [x] The final §H corrections (session continuity, OAuth project choice, secret handling) edit this plan only. They
  are a prose review: they prove nothing about hosted or runtime behaviour, and all 17 gates stay outstanding.

Codex verified:
- the 53 tests pass after the follow-up;
- no Go file changed;
- the diff adds exactly these four files, with the frozen tests unchanged.

## G. Not in this slice (each later, red first, separately approved)
- **Go API:**
  - a Cloud Run admission profile that does not weaken Host, CORS or forwarded-header checks;
  - a secret-mount loader;
  - the DSN `verify-full` guard and the startup `search_path`/isolation assertion;
  - a production deployment profile and a native-only origin policy;
  - linux/amd64 builds with an embedded revision.
- **Database:** a reviewed, non-superuser SQL bootstrap for the hosted roles and schemas, Data API exclusion, and grant checks.
- **Templates and docs:** a GoTrue Cloud Run settings template and a `deploy/cloudrun/README.md`, clearly not apply-ready and true to today's unsupported guards.
- **Hosted validation** in a disposable project (needs authorization and project access): migrations, catalog and grant checks, TLS and session settings, backup and restore with ledger replay.
- **RN:** real-email sign-up and reset, secure persistent sessions, export and deletion screens, OAuth-only re-auth, and the API request deadline.

## H. Portability and migration (descriptive; source-based recommendations, not executed proof)
The owner intends to move from the interim owner to a proper GCP account. This section only separates the possible
moves and lists what each must review. It approves no access, billing or OAuth change, adds no task to this slice and
holds no command, grant or credential. No move is promised to need zero change.

### H.1 Three different moves
| Move | Usually stays | Must be decided or redone |
|---|---|---|
| **A. New human access on the same project** (a proper account is added, the interim owner reduced later) | Project ID and number, resource IDs, service URLs, service identities, secrets, OAuth client, origins | Who may administer: IAM ownership, contact and recovery details, billing administration if linked later. The project must never be left without an accountable owner. |
| **B. Move the same project into an organization** | Project ID and number, resource names, service URLs, normally the service identities | Inherited IAM and organization policy now apply and may restrict or change resources; the migration checklist and special-cases pages must be read for billing, OAuth and secret handling before any move. |
| **C. Rebuild in a new project** | Source revision, images (by digest), the Supabase database if unchanged, the Auth issuer and its keys if so decided | New project ID and number, new resource IDs and service URLs, new service identities, new secrets and versions, possibly a new OAuth client. Every binding is re-made explicitly. |

### H.2 What every move must review
- **Ownership and IAM.**
  - Record who holds owner and billing roles, and prefer named roles on named resources over broad ownership.
  - Keep personal accounts out of product sources, the example, templates and tests. They live in the decision
    record and in IAM only.
- **Billing.** Linking a billing account is a separate approval by that account's administrator. A move does not by
  itself decide the link, and an unlinked project stays unbilled until that approval.
- **OAuth.**
  - Review the client, its authorized redirect (`<auth origin>/callback`), the consent screen's name, contacts and
    publishing or verification state, and Google's policies.
  - A new Cloud Run runtime project does not by itself require moving the OAuth client project. There are two
    explicit choices, each needing the owner's approval:
    - keep the existing, separately controlled OAuth project, with approved access for whoever manages it; or
    - deliberately create new clients in the new auth project, then re-bind the client IDs, secret references,
      callbacks and consent settings, and verify any changed consent.
  - No client transfers automatically, and neither choice is a zero-change guarantee.
- **Service identities.**
  - Keep separate runtime identities for the API and for GoTrue, a deployer, and a backup identity, each with
    least privilege.
  - Identities belong to a project, and attaching one to a service is itself a permission. In a new project every
    identity is new, so every grant that named an old one is re-made. No downloaded key is part of this plan.
- **Secret Manager.**
  - Secret names and version numbers belong to a project. A new project recreates them, so the packet's pinned
    `secret` and `version` references are re-pinned.
  - Grant each runtime identity access to only the secrets it reads.
  - Never hand a value over in chat, logs, the repository or any plaintext message. Use an approved secure secret
    delivery path and handle the value under protection. Runtime mounts are files, so file permissions and cleanup
    matter, but a file is not an approved handoff. No secret value appears in this plan.
  - Prefer deliberate rotation with an overlap in which old and new both work: database credentials, the admin
    credential, SMTP and the JWT secret.
- **Auth identity and keys.**
  - Accounts are keyed by issuer and subject (`backend/internal/store/migrations/0001_init.sql:10`). An arbitrary
    issuer change can strand the API's issuer-and-subject links to existing accounts.
  - Unchanged durable signing keys alone do not guarantee that existing sessions and tokens survive. Continuity also
    needs a compatible issuer, audience and verification policy, persisted Auth users, sessions and refresh state, and
    working revocation handling.
  - Real sign-in, refresh and logout must be checked before any traffic switch.
  - Rotating the key set is its own planned change with an overlap.
  - Consider a stable custom domain as the issuer before any real account exists, so that a later move does not
    change it.
- **Images and region.**
  - Images move by digest and provenance, and the gates for a linux/amd64 API image and the GoTrue platform still
    apply.
  - The region of the services, the registry and the database affects latency and, for Cloud Run, the service URLs.
- **Origins, CORS, domains and native config.**
  - A new project's default service URLs differ, so the API's allowed origins and CORS, Auth's site and redirect
    settings, and the RN app's origins change with them.
  - DNS and any custom domain should stay under the owner's control and outlive any one project.
  - Native identifiers and callbacks follow the OAuth registration.
- **Database.**
  - The Supabase PostgreSQL project can remain if it is unchanged. Its credentials are still rotated and rebound.
  - Changing the database needs its own data plan: schemas, roles, a verified backup and restore, and
    deletion-ledger replay.
- **Backup, restore and the ledger.**
  - Before any move, take a backup and rehearse a restore with deletion-ledger replay, so deleted accounts stay deleted.
  - Name the backup identity and storage location in the target.
- **Rollback.**
  - Leave the old services, secrets and credentials untouched until the new ones pass verification.
  - Revoke and delete only after an acceptance window.
  - A traffic switch by origin or DNS is reversible only if planned for in advance.

### H.3 Reviewed references (not browsed by the author of this edit)
- https://docs.cloud.google.com/resource-manager/docs/project-migration
- https://docs.cloud.google.com/resource-manager/docs/project-migration-checklist
- https://docs.cloud.google.com/resource-manager/docs/handle-special-cases
- https://docs.cloud.google.com/billing/docs/how-to/modify-project
- https://docs.cloud.google.com/iam/docs/service-account-overview
- https://docs.cloud.google.com/iam/docs/attach-service-accounts
- https://docs.cloud.google.com/secret-manager/docs/how-to
- https://developers.google.com/identity/protocols/oauth2/policies
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
