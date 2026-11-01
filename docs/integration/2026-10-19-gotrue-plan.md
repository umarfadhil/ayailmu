# GoTrue Mobile Accounts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. One writer;
> read-only Codex review after implementation. No implementation delegation.

**Goal:** Replace the synthetic lab's Keycloak flow with separate GoTrue identity
and complete the native account lifecycle while preserving native learning/data.

**Architecture:** GoTrue verifies credentials and issues ES256 sessions; the Go
API verifies its issuer/JWKS and signed authentication freshness. Android account
UI uses a tested HTTP/session adapter, encrypted local token storage and existing
owner-scoped sync. Legacy identities and runtime remain preserved.

**Tech Stack:** Existing Go/Postgres/Kotlin/Compose; GoTrue2.197.0, local Mailpit,
go-oidc/go-jose, AppAuth PKCE helper, Tink Android Keystore.

**Spec:** [GoTrue design](2026-10-19-gotrue-design.md)

## Global constraints

- Keep published `3b4f206` unchanged; all follow-up stays local.
- No real Google credentials/grants/project creation or real user data.
- No Amar worktree/database changes; no Swift/Expo/framework rewrite.
- Preserve Keycloak identity and app records; no email-based identity merging.
- Only fabricated ADULT/DEMO learning; no native mastery changes.

## Review focus

- Refresh may change `iat` but must not renew sensitive-operation freshness.
- Logout/account change during refresh/callback cannot restore another session.
- Confirmation/recovery code belongs to its email and intended flow.
- Google callback without a live PKCE intent, replay, cancellation or expiry fails closed.
- Offline/expired auth never discards opted-in native answers or crosses owners.

### Task1: Provider and API boundary

Status 2026-10-19: implemented and verified locally (committed checkpoint `90ccf1f`).

Files: `backend-umar/internal/auth/gotrue.go`, `auth_test.go`, `cmd/server/main.go`,
`internal/api/api.go`; `integration/compose.yaml`, preserved legacy Compose,
local secret/init/launch and fixture scripts.

- [x] Add failing ES256 issuer/audience/role/session/AMR and refresh-freshness tests.
- [x] Add GoTrue mode using existing maintained verifier libraries and a read-only
  `GET /v1/account` endpoint. Keep legacy verifier behavior/test coverage.
- [x] Initialize isolated GoTrue identity DB/keys/mail sink without changing old
  volumes. Run real signup/confirm/login/refresh/recovery and invalid-token tests.
- [x] Run Go race/Postgres suite; commit the independently tested provider slice locally.

### Task2: Native account/session boundary

Status 2026-10-19: implemented by the Kimi writer; two review rounds closed; verified in
this checkpoint (see `2026-10-19-gotrue-verification.md`). Round 2 hardened local
commit/activation coordination: generation-atomic credential installs/clears and UI
publishes, a local ordering boundary for native activation/cleanup (never across
network), independent fail-closed cleanup, narrow conclusive-invalid classification
(5xx/offline preserve sessions), origin-fenced auth-flow results, and in-flight Google
exchange invalidation.

Files: new `android/core/sync/.../GoTrueAuth.kt`, auth tests; sync contracts/engine;
Android lab auth repository/vault/callback; lab resources/manifest/build dependencies.

Interfaces: opaque `AuthSession` and verified `AuthUser`; adapter methods signup,
verify, signIn, refresh, recover, updatePassword, signOut, OAuth URL/code exchange.
`SyncEngine.resume(token)` verifies `GET /v1/account` matches the durable owner.

- [x] Add failing protocol, refresh rotation, late response, logout and callback tests.
- [x] Implement bounded HTTP adapter with no redirects/logging; use maintained PKCE
  helper and Tink for persisted session material. Restore/refresh only same owner.
- [x] Add Android sign-in/signup/confirmation/recovery/account/settings routes,
  transient password fields, generic errors and disabled-by-default Google action.
- [x] Run unit/Room/real-service E2E tests and ordinary flavor compilation; commit locally.

### Task3: UX/device and setup handoff

Status 2026-10-19: partially complete; recorded in `2026-10-19-gotrue-verification.md`.

Files: integration verification/Google setup docs and repeatable synthetic tests.

- [ ] Inspect Memvios reference if exact local path becomes available; report its
  stack and account UX without copying proprietary implementation/assets.
- [x] Run disposable-emulator account, offline learning, sync, expiry and logout
  tests; record actual callback/browser coverage and any unavailable setup.
- [x] Check unchanged backup/export lint diagnostics and platform scope precisely.
- [ ] Read-only Codex review; reproduce/fix material findings, rerun affected tests.
- [x] Record minimal Google Web OAuth setup/redirects and specific approval steps;
  report local commits, passed coverage and outstanding path/credential blockers.
