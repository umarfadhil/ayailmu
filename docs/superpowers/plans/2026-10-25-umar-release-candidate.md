# Umar Release Candidate Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline with one writer at a time.

**Goal:** Validate safer remote PostgreSQL transport and produce verifiable unsigned Android/backend candidate artifacts through CI, without activating production.

**Architecture:** Keep Go/Postgres/self-hosted GoTrue and the native Android flavor boundaries. Kimi K3.1 Pro HIGH authors backend behavior; Sonnet5.5 HIGH authors infrastructure. Codex inspects, independently verifies and publishes the scoped checkpoint. Neither author may alter credentials, running auth, real-user gates, content approval, hosting or store access.

**Tech Stack:** Go/pgx, PostgreSQL, Kotlin/Gradle Android, GitHub Actions, Python standard-library artifact validation.

**Spec:** Existing docs/integration/2026-10-21-production-and-mac-test.md and backend-umar/deploy/README.md; latest user authorization extends reversible CI/release preparation, not deployment.

## Global Constraints

- One writer; Umar worktree only. Existing branch/PR3. Do not edit Arabic or its workflows.
- Never read/publish credentials, generate keys, grant access, provision resources, merge, expose services or publish a store release.
- Production content remains draft-gated; ordinary demo/prod app has no synthetic auth graph.
- Local Postgres literal loopback and Unix socket test connections remain supported. Remote connections require authenticated TLS with no plaintext fallback.
- Unsigned bundle/binaries are release candidates, not installable/store releases or CD deployments.

## Review Focus

- Mixed/fallback Postgres hosts cannot downgrade TLS on a remote destination.
- A public hostname resembling localhost is not a loopback exception.
- Configuration errors never disclose connection strings/passwords.
- Candidate artifact metadata must match source revision, platform and actual files.
- CI must not accept draft/synthetic content as reviewed or require production secrets.

### Task 1: Remote database transport validation (Kimi HIGH)

**Files:** backend-umar/internal/store/store.go; focused transport implementation/tests alongside it; backend-umar/deploy/README.md.
**Interface:** Validate parsed pgxpool config before creating a pool. Preserve literal-loopback/Unix-socket defaults; reject every remote main/fallback destination without hostname-verifying TLS and no plaintext downgrade. Use existing pgx/TLS; no custom crypto, DNS calls or live database configuration.

- [ ] Add failing table tests for remote disable/prefer/allow/require/verify-ca, verified remote, literal IPv4/IPv6 loopback, Unix sockets, deceptive hostnames and mixed fallback targets.
- [ ] Implement the minimal validation and generic redacted error.
- [ ] Run focused tests then full disposable Postgres race suite and go vet.
- [ ] Independently review diff and existing-runtime compatibility.

### Task 2: Candidate artifacts and runbook (Sonnet HIGH)

**Files:** new .github/workflows/umar-release-candidate.yml; standard Go build-info/checksum commands in that workflow; docs/integration/2026-10-25-release-candidate.md. Avoid changes to existing shared workflows.
**Interface:** On scoped PR and manual dispatch, run applicable checks with disposable Postgres, build unsigned prod AAB plus Linux amd64/arm64 API/migrator, package deterministic source/platform manifest and checksums, upload finite-retention artifacts. Never request deployment/secret permissions.

- [ ] Validate explicit artifact allowlist, embedded Go revision/platform, clean source and checksums with actual local artifacts.
- [ ] Implement and validate the workflow using maintained actions and standard tools; add no packaging framework.
- [ ] Build actual unsigned AAB and both backend architectures locally; verify candidate metadata and checksums.
- [ ] Document staging versus production, deployment/rollback/backup boundary and exact owner inputs for host/DB/TLS/SMTP/signing/store setup. iOS is absent; no rewrite included.

### Task 3: Review and publication

- [ ] Independently inspect all diffs and evidence; preserve unrelated work.
- [ ] Run applicable gates on the final snapshot; no test suppression or source stubs.
- [ ] Commit/push this scoped verified checkpoint to existing branch/PR3 and inspect exact-head CI. No merge or deployment.
- [ ] Report model verification, artifacts, CI versus local evidence, mobile/store blockers and one batched approval list.

## Execution ledger

Task1: complete, Kimi K3.1 Pro HIGH; focused RED→GREEN, full disposablePG race122 pass0fail0skip, vet/build0.

Task2 Ruling: after a tools-disabled Sonnet HIGH request returned no patch within240seconds, reduce infrastructure output to the candidate workflow/runbook using standard Go build-info and checksum commands instead of a custom packaging framework. Same candidate guarantees, less new code; actual artifacts and CI validate it. No fallback model, credentials or trust grants. One bounded smaller recovery, not repeated full requests.
