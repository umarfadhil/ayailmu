# Plan: provider-neutral single-VPS Compose preparation, and production-auth separation

**Status: plan only.** Implementation starts after the account controls are green; every code change below gets red
tests first.
- Nothing has been rented, started, bound or requested; no ACME request has been made.
- Every host, origin, path, digest and secret below is a placeholder.
- Root validates only local synthetic overrides.
- Root's review (`root-design-review-notes.md` §5) is applied here as wording corrections only, on 2026-10-18.
  Versions and digests come from Root's verified references, read at the start of the VPS phase:
  `input/version-references.json`, `official-image-manifest-references.json`, `caddy-image-constraint.md` and
  `provider-decision-steering.md`.

## A. Constraints taken from the source
| Fact | Source | Consequence |
|---|---|---|
| `production` is refused and `staging` is an unknown mode, both pinned by tests | `config_test.go:108-109`, `startup_guards_test.go:37` | `production` stays `ErrProductionRefused` until a verifying adapter is configured. Never name a mode `staging`. |
| The service migrates at startup through its runtime pool | `server.go` (`New`: `st.Migrate`), `store.go:85-134` | The runtime role needs DDL today. Split migration out: a one-shot job, and a runtime that only verifies the schema version. |
| Listen addresses and database hosts must be loopback; any Unix socket directory is accepted | `config.go:125-156,235-252`, `store.go:42-64` | Keep this exactly in emulator mode. Deploy modes need explicit, exact allow-lists. |
| CORS origins are a constant, and the Host list comes from the listen address | `cors.go:12`, `config.go:169` | Inject exact origins and hosts in deploy modes; emulator defaults stay. |
| Health reports only that the process serves | `meta.go:14-18` | Add a readiness route that checks the database and schema version. |
| The process environment switches the Admin SDK to unsigned emulator mode | `authn.go:85-89` | Outside emulator mode, refuse `FIREBASE_AUTH_EMULATOR_HOST` whenever it is set, even empty. |

## B. Modes
- **`emulator`:** unchanged; every current guard stays.
- **`production`:** stays refused (`ErrProductionRefused`) unless `AYA_AUTH_PROVIDER` names an implemented adapter
  with valid settings. The pinned test sets no provider, so it keeps passing. Once accepted, it requires:
  - exact `AYA_ALLOWED_HOSTS`;
  - exact HTTPS `AYA_CORS_ORIGINS` (empty means native-only);
  - `AYA_DB_HOSTS`, an exact allow-list checked against every host pgx parsed;
  - the database URL read from `AYA_DATABASE_URL_FILE` (a Docker secret);
  - no emulator variable and no `demo-` project.
- **Selected (2026-10-18): `AYA_MODE=deploy-smoke`**, for local synthetic validation of TLS, the database, readiness
  and the containers, without choosing an identity provider:
  - the production network and database guards above apply, and every authenticated route answers the uniform 401
    (a verifier that rejects all tokens, with no emulator fallback);
  - health and readiness work;
  - it never accepts a token, so no data can be read or written.

  It is never presented as production auth working. Production stays refused until a chosen verifier is implemented.

## C. Code changes (each red first)
1. **`cmd/ayailmu-migrate`:** applies the embedded migrations with the owner role, prints only the resulting version
   and exits non-zero on failure. `store.Migrate` is reused.
2. **`AYA_MIGRATIONS=verify`** (the default outside emulator mode): startup checks that the highest
   `schema_migrations` version equals the latest embedded one, or refuses with `ErrSchemaNotCurrent`. No DDL runs as
   the runtime role. Emulator mode keeps migrating at startup.
3. **Deploy configuration (§B):**
   - new errors that name the variable and never quote its value;
   - `0.0.0.0:8080` listening allowed in deploy modes only;
   - HSTS in deploy modes.
4. **`GET /v1/readyz`** (public): a database ping plus the schema version. It answers `200 {"status":"ready"}` or
   `503 {"status":"not_ready"}`, without detail. `/v1/healthz` stays the liveness check.
5. **`ayailmu-api probe <url>`:** a tiny subcommand for the container healthcheck (the runtime image has no shell or
   curl). It accepts loopback URLs only.
6. **Later gate:** per-account and per-IP rate limits (staging-plan G7).

## D. Artifacts (`deploy/`, placeholders only)
- **`Dockerfile`:**
  - builder: the official Go image, at the version and multi-arch digest Root verified, building
    `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" ./cmd/ayailmu-api ./cmd/ayailmu-migrate`;
  - runtime: `scratch`, with the CA roots copied from that verified builder (or a verified Docker Hub base), so no
    Google- or AWS-hosted runtime base is implied; `USER 65532:65532`, no shell, `EXPOSE 8080`;
  - no claim of fully reproducible images until the build inputs are actually pinned and tested.
- **`compose.yaml`:**
  - **networks:** `edge` (proxy only); `app` (internal, proxy↔api); `data` (internal, api, migrate and backup↔db).
    - Internal networks cannot reach a remote identity provider for signing keys, revocation or deletion. Once a
      remote provider is chosen, the API gets one explicit outbound HTTPS route (an egress network attached to `api`
      only). The database never joins it.
    - `deploy-smoke` stays fully internal.
  - **`db`:** the official Postgres 16 image, at the version and multi-arch digest Root verified.
    - no `ports`, volume `pgdata`, a `pg_isready` healthcheck;
    - passwords come from secret files;
    - `postgres/init/10-roles.sql` creates the roles: `aya_owner` (owns schema `ayailmu`, used only by migrate),
      `aya_runtime` (CONNECT, USAGE and DML on the schema's tables through default privileges; no DDL) and
      `aya_backup` (read-only, for `pg_dump`). It also revokes `CREATE` on schema `public`.
  - **`migrate`:** the API image with entrypoint `ayailmu-migrate`, `restart: "no"`, `profiles: ["ops"]`, and the
    owner DSN from a secret file.
  - **`api`:**
    - `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `user: 65532:65532`;
    - the runtime DSN from a secret file;
    - healthcheck `ayailmu-api probe http://127.0.0.1:8080/v1/readyz`;
    - no published port.
  - **`proxy`:** the official Caddy image, at the version and digest Root verified (read `caddy-image-constraint.md`
    before writing the Caddyfile), published 80 and 443, volumes `caddy_data` and `caddy_config`, and `Caddyfile`
    with:
    - `{$AYA_PUBLIC_HOST}`;
    - `reverse_proxy api:8080`;
    - HSTS;
    - `request_body max_size 17MB`;
    - logs without the `Authorization` header or bodies;
    - the ACME email as a placeholder.
  - **`backup`:** the same Postgres image's client tools, `profiles: ["ops"]`, `pg_dump -Fc` as `aya_backup`, written
    to a mounted backup directory (placeholder).
- **`compose.local-synthetic.yaml`** (Root's validation override): `tls internal` (no ACME), the proxy bound to
  `127.0.0.1` only, synthetic secrets from a temporary directory, `AYA_MODE=deploy-smoke`.
- **`.env.example`** with placeholders only. `deploy/secrets/` is gitignored, and real values are never committed or
  logged.
- **`scripts/backup.sh`** and **`scripts/restore-check.sh`.** The restore check:
  - restores the newest dump into a throwaway Postgres (`--network none`, fresh volume);
  - checks the `schema_migrations` version and per-table row counts;
  - destroys the throwaway instance;
  - never touches the live database.
- **`backend/docs/VPS_Operations.md`:**
  - health and readiness;
  - the migration order (backup, then the migrate job, then the API rollout);
  - backups and a monthly restore drill;
  - rollback by image digest;
  - the export and deletion request runbook;
  - the log policy;
  - recommendations a human applies to the host (firewall, SSH, updates). The agent changes none of them.

## E. Backups, erasure and rollback (decisions needed)
- **Backup retention:** nightly dumps kept for N days. N, and any off-host copy, are human decisions; no cloud
  resource is created here.
- **Erasure and backups:** deleted accounts persist in dumps until those expire. Restoring an older dump resurrects
  them.
  - Proposal: on each erasure, log one structured line (`deletion_id`, `account_id`, time), and keep those logs at
    least as long as the dumps.
  - The restore runbook then re-applies every erasure logged after the dump's timestamp, through a future operator
    command. Until that command exists, the runbook marks restore as manual.
  - The restore drill runs on a throwaway instance only. It proves dump and restore, plus re-applying a synthetic
    deletion manifest. A live restore is not authorized.
- **Rollback:**
  - releases are pinned by image digest, and the previous digest is kept;
  - migrations are expand-only per release;
  - rollback means the previous digest when the schema is compatible; otherwise restore and re-apply erasures. The
    RPO and RTO are stated in the runbook;
  - never roll back to a binary without the deletion guard while any deletion record exists: it would serve, or
    re-create, erased accounts.

## F. Production auth adapter (held until the human chooses)
Both choices are behind `SessionVerifier` and `IdentityDeleter`; neither is implemented before the choice. The
human's current steer, as reported on 2026-10-18: minimum cost, and wary of Google and AWS. The choice is still
open (see `provider-decision-steering.md`).

**Firebase reuse** (Root's recommendation; the current SDK):
- `authn.FirebaseVerifier`: `VerifyIDTokenAndCheckRevoked` against a real project, with the issuer and audience
  pinned, anonymous and tenant tokens refused, and `auth_time` returned.
- The revocation lookup and `DeleteUser` need Admin credentials. On a VPS with no metadata server, that means a
  service-account key mounted as a Docker secret, scoped to user read and delete: a **persistent real credential**
  that needs explicit human approval.
- Verification alone (public keys) needs no credential, but it would lose revocation and server-side deletion.

**Self-hosted Keycloak:**
- OIDC discovery and JWKS signature verification. The `go-jose` dependency is already indirect; `go-oidc` would be a
  new direct dependency to approve.
- `auth_time` needs the matching session settings. Deletion goes through the Admin REST API with a confidential
  client.
- Costs: another container, its own database schema, backups and upgrades, and an OIDC PKCE flow in RN. Its memory
  and CPU needs are an unverified planning assumption until checked against official Keycloak sizing guidance.

**Either way:** production refuses emulator variables and `demo-` projects, and the emulator adapter stays usable in
emulator mode only.

## G. Root validation later (local, synthetic)
1. `docker compose -f deploy/compose.yaml -f deploy/compose.local-synthetic.yaml config`, then build.
2. `up` in smoke mode. Check:
   - no database host port;
   - UID 65532 and a read-only root filesystem;
   - internal networks only;
   - the migrate job is idempotent;
   - readiness is green and `/v1/me` answers 401;
   - `restore-check` passes on a synthetic dump;
   - a rehearsal of rolling back to the previous digest succeeds.
3. No public bind, no ACME request, no real credential at any step.

## Open human decisions
- the identity provider;
- backup retention and any off-host copy;
- deletion-record retention and the deletion contact;
- domain and public host (later);
- VPS vendor (later, separate approval).
