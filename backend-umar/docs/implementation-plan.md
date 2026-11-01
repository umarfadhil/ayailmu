# Umar backend implementation plan

Goal: useful synthetic-only Postgres vertical slice from architecture.md.
Execution: one Codex writer, inline, as explicitly requested. No pushes or merges.

1. Registry and native validator (`internal/catalog`, `internal/native`): write
   failing fixture tests, generate deterministic registry from pinned assets,
   implement all six response kinds including trace/story; reject malformed data,
   speed_round, child free text, duplicate JSON keys and unsupported schema.
2. Storage (`internal/store`): failing Postgres integration scenarios; migration
   ledger/advisory lock, accounts, profiles, consent history, immutable events;
   atomic batch retry/conflict and serialized learner-local cursors.
3. OIDC and HTTP (`internal/auth`, `internal/api`, `cmd/server`): failing real
   JWKS/HTTP tests then implementation. Verify issuer/audience/type/client/scope,
   expiry/nbf; require fresh auth for account/guardian management, minimize errors,
   bind owner on every query. Synthetic-only compile-time contract.
4. Local launcher and verification (`compose.yaml`, `scripts`, README): isolated
   secrets/ports/volumes, real Postgres integration, real Keycloak token smoke if
   runtime permits, race suite/vet/vulnerability scan, clean local commits.

Review focus: same learner ID under two owners; reordered concurrent commits;
partial batch conflicts; withdraw/upload race; nested/duplicate/malformed payloads;
JWTs signed by the correct provider but wrong audience, type, scope or client.

Each task records RED/GREEN evidence and final limitations in verification.md.
Native/Expo files and mastery algorithms are outside the editable scope.
