# Release preparation and temporary Mac test checkpoint — 21 October 2026

The user authorized Codex GPT-6.1-Sol/XHigh through this task's API for app/backend fixes, reversible production preparation and verified publication. The task used its own coding tools with one writer. The earlier CLI attempt recorded the requested model but was rejected by its ChatGPT transport before source operations; it is not implementation evidence. Kimi/Claude were not used after the override, and the old Claude trust request is superseded.

## Implemented

The gallery test read `state.value` immediately after `viewModelScope.launch`, racing the initial `Loading` state. A local baseline failed its Ready assertion at line549; CI failed the same method's next assertion at551. The repaired test installs a controlled Main dispatcher and drives the actual load before preserving the original Ready/null/exception assertions. A deferred-source case also proves Loading persists until completion. Production gallery scheduling is unchanged. All 37 StoryTest cases passed in the first focused run.

Release lint rejected three redundant `file/cache/` exclusions outside the database/DataStore include allowlist. Removing those exclusions preserves backup scope and the separate syncLab no-backup manifest. Full lint then exposed a literal BOM in CSV export source; replacing it with `\uFEFF` preserves the same exported character/bytes. Existing CSV tests still assert BOM/header/quoting behavior. No lint suppression or test assertion weakening.

The synthetic lab now accepts a build-time public HTTPS origin with canonical validation. Empty retains existing local defaults; public origins configure both clients and produce the separate `.synclab.remote` application ID. Ordinary demo/prod builds still lack this auth/sync graph. API `UMAR_PUBLIC_ORIGIN` and an explicit OIDC issuer must agree exactly, checked before DB migration; existing local/Keycloak defaults are preserved. GoTrue's un-applied override derives its issuer/external URL from that same origin and disables signup. No running provider, key, credential or issuer has been changed.

The [temporary test packet](../../integration/tunnel/README.md) contains an implemented, tested allowlisted loopback router, bounded foreground-agent wrapper, dry-run exposure planner and secret-free configuration templates. The router refuses nonloopback upstream/listen addresses, unknown/admin/signup routes, unsafe query/path forms, oversized requests and lifetimes beyond 30 minutes. It retains bearer verification upstream, strips caller-supplied forwarding headers and redacts connection errors. It does not open a tunnel. Tester-IP enforcement is an ngrok edge requirement, not a claim made by the local proxy.

## Verification

On the same frozen source/config/test snapshot:

- Full backend suite: **23 top-level tests**, zero failures/skips, race detector and fresh disposable Postgres; `go vet ./...` passed.
- Pure Kotlin: **81 engine + 73 content tests**, zero failures/errors/skips; model task has no test sources. Pack validation passed.
- Demo/data CI gates: **294 app + 40 data tests**, zero failures/errors/skips; demo lint and assembly passed.
- Production lint and **unsigned** release assembly passed. Existing ktlint task passed under its nonblocking `ignoreFailures=true` configuration; this does not mean there are no style findings. Lint retains existing warnings; no suppression was added.
- Public-origin staging APK assembly passed, and artifact metadata confirms `.synclab.remote`; an HTTP public-origin build was correctly rejected. Endpoint tests passed **3/3**. The default local APK was rebuilt separately.
- Sequential real-service suites passed **20 JVM + 62 Android account/Room tests**, zero failures/errors/skips, true exits 0. They exercised isolated GoTrue/API/Mailpit and actual issued-token expiry; generated token fixtures were removed.
- **6 Python planner/deadline tests** passed. Compose and merged ngrok configuration syntax checks passed without applying them. The real router returned health 200, denied admin/signup/settings 404, preserved auth 401, expired after its two-second smoke test, and rejected wildcard binding.

All 23 frozen implementation/config/test hashes matched after verification. A passing production assembly produces an **unsigned** artifact, not a signed/store release. Exact new-head hosted CI is tracked in the draft PR after publication and is separate from these local results.

The Android endpoint tests first produced two intended failures against local-only behavior, then passed3/3 with a preserved local positive control. Router/issuer tests failed against non-forwarding/unguarded stubs before implementation; no temporary stubs remain. Planner and owned-agent deadline tests likewise ran red then green. Full device/tunnel smoke tests, external allow/deny verification and public-issuer token flow remain unperformed because public exposure/security-sensitive restarts require approval.

## Production readiness: still blocked for real users

| Area | Current evidence and remaining decision/work |
| --- | --- |
| Content release | All 3162 registered items across 73 packs are draft, including 17 Arabic synthetic items. Existing production gating excludes draft/synthetic content. Authors must select and review actual release content; no item was relabelled. A successfully built prod APK currently has no approved learning catalog. |
| Real-user collection/consent | API and schema require synthetic data. Adult/guardian ownership and per-learner opt-in are prototype contracts; policy purposes, age assurance, Arabic 18+ eligibility, store/privacy declarations and real-data UX require explicit decisions/review. No compliance claim. |
| Export/deletion/retention | Existing native export is local. Server real-user export/deletion/retention is not implemented; immutable event/consent triggers must not simply be bypassed. Choose scope, legal retention and recovery behavior before designing that change. |
| Identity/security | Exact issuer/audience/JWKS and ownership checks remain. Live Google is disabled. Production needs restricted DB/migration roles, key/credential lifecycle, real SMTP, TLS/domain/redirect policy, auth throttling and a device threat review. No new secrets or provider grants here. |
| Operations | Mac/ngrok is a temporary supervised synthetic route. Production needs an explicit host/budget, process supervision, request/storage limits, patching, privacy-safe metrics/alerts and backup/restore ownership. No infrastructure was provisioned. |
| Native distribution | Debug test APK and unsigned prod assembly are distinct artifacts. Production signing/Play setup, device compatibility and actual release packaging remain approval-dependent. Do not distribute the synthetic flavor to real learners. |

## Deployment, rollback and backup/restore preparation

Do not go live from this branch. The tunnel runbook describes the exact service/configuration changes and rollback, preserving keys, volumes and old issuer namespaces. Starting a public endpoint or applying auth/issuer overrides is a separate action-time gate even though source publication is authorized. Only an approved existing ngrok account may be reused; account/policy capacity is not verified by a config syntax check. No purchases or relaxed controls on failure.

For a future production deployment: pin reviewed image/binary/source digests and CPU architecture, take an approved consistent backup, apply backward-compatible migrations under a restricted migration identity, start the new API privately, verify readiness and a synthetic canary, then switch the reviewed proxy target. Stop the canary/switch back on failure; restore the prior binary/configuration only when schema compatibility is established. Never assume reverting Git reverses a database migration. Restore into a new isolated target before considering any destructive recovery.

A backup must cover **both** application Postgres and GoTrue identity Postgres, approved auth signing/session configuration, and any native journal/outbox storage involved in the desired recovery boundary. Use `pg_dump -Fc`/`pg_restore` with reviewed role/extension ownership handling, consistent maintenance/snapshot coordination across the two DBs, encrypted restricted destinations, integrity hashes, documented retention and access/rotation ownership. No backup secrets belong in Git or reports. Verify counts, ownership links, idempotent replay/sequence cursors, consent withdrawal and sign-in/refresh after restoring to throwaway isolated databases; original databases remain untouched. Test loss of the auth signing key and rotation policy separately before accepting a recovery procedure. Real-user backup retention/deletion decisions remain unresolved.

The backend integration suite verifies migrations, transactions, isolation and replay in disposable Postgres. It is **not** evidence that a coupled production backup/restore drill has happened. No persistent database was dumped, restored or deleted by this preparation, and no signing key was generated.

[Local launch](../../integration/README.md) · [Temporary route and approval details](../../integration/tunnel/README.md) · [Backend schema/API](../../backend-umar/docs/architecture.md).
