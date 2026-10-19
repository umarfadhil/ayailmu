# Plan: account export and deletion (backend first, then RN)

Contract: `docs/superpowers/specs/2026-10-18-account-export-deletion-design.md`.

Every phase is red, then green. Root runs every command and owns services, commits and pushes. Nothing here touches
production, providers outside tests, `ayailmu-publish`, main/Umar, the engine, content, pedagogy or history.

## Phase 1 — RED (written 2026-10-18)
| File | Change |
|---|---|
| `backend/internal/server/account_controls_test.go` | new: 6 top-level HTTP and PostgreSQL integration tests |
| `backend/internal/server/server.go` | compile-only stub `Options.BeforeIdentityDeletion func(ctx) error`, declared and **not wired** |

The expected failures, test by test, are in the private handoff (`phase1-red-handoff.md`). In short:
- every new export or deletion request answers today's `404 not_found` (unknown route), so each test fails on its
  first such request;
- the 31 existing top-level tests stay green.

## Phase 1 refinement — RED (after Root's design review, 2026-10-18)
Same file, no production code, no new stub. The 6 original tests and their assertions are unchanged.

| Change | Pins |
|---|---|
| `emulatorHasUser` hardened | The answer must be read whole and be one JSON object. Absent means `200` without users or `400 USER_NOT_FOUND`; present means `200` with exactly this uid; anything else fails the test. |
| new `TestDeletionWaitsForAnImportWithoutHoldingTheAccountRow` | Deletion queues for the import's advisory lock holding no lock on the account or profile rows (fixture transaction, `pg_locks`, `NOWAIT`). It then erases what that import committed. |
| new `TestExportIsBoundedAndNeverPartial` | Through `AYA_EXPORT_MAX_BYTES`: a body of exactly the limit is served; one byte over gets 413 `export_too_large` with no partial export. The 16 MiB default holds with a ~15 MiB fixture served and a ~18 MiB one refused. The setting can only lower the limit. |

Expected failures are in `phase1-refinement-handoff.md`.

## Phase 1b — GREEN (minimum, in this order)
**Status (2026-10-18):** implemented by the Team worker with file tools only; nothing compiled or run by it. Root's
`gofmt`, `go vet`, normal and race runs are pending. Concrete choices beyond the steps below: keyset-paged export
reads (pages of 64 rows) instead of `DECLARE CURSOR`; a chunked export buffer; the deletion routes are not served
without a session verifier and an identity deleter; an empty `GET /v1/me` list of a deleted account is `410`.
Extra focused tests: `TestVerifySessionReportsTheVerifiedSignInTime`, `TestDeleteIdentityRemovesOnlyThatEmulatorAccount`
(authn) and `TestLoadExportLimitCanOnlyBeLowered` (config), so the expected total is 42 top-level tests.

1. **Migration.** `store/migrations/0002_account_deletion.sql` creates `account_deletions` (spec §6.4). `0001` is not
   changed.
2. **authn** (only additions; no existing test changes):
   - `Session{Identity; AuthTime time.Time}` and `SessionVerifier{Verifier; VerifySession}`. `Identity` stays as it
     is, because `authn_test.go:184-186` compares it by value.
   - `IdentityDeleter{DeleteIdentity(ctx, Identity) error}`.
   - `EmulatorVerifier.VerifySession`: the same checks as `Verify`, plus `AuthTime` from the SDK token's `auth_time`
     (zero when absent).
   - `EmulatorVerifier.DeleteIdentity`: `client.DeleteUser(ctx, subject)`. A "user not found" answer counts as
     deleted. Errors carry their class only.
   - New authn tests: `auth_time` surfaces from a changed claim; `DeleteIdentity` removes an emulator user, and
     repeating it is harmless.
3. **store:**
   - `EnsureAccount` returns `Account{ID; Deleted}`, reading `account_deletions`. Its only caller is
     `httpapi/auth.go`.
   - `ErrAccountDeleted`:
     - `Import` re-checks the deletion after its advisory lock;
     - every lookup that finds no profile checks `account_deletions` before answering `ErrNotFound`:
       `OwnsProfile`, `Profile`, `Ingest`, `UpdateSettings`, and `snapshot` (pull and progress). Without this, a
       request authenticated just before the erasure committed would get 404 instead of 410 (the third case of
       `TestDeletionSerializesWithIngestAndImport`).
   - `ExportAccount`: one read-only REPEATABLE READ snapshot holding every column of the account's rows.
     - It reads rows in order through cursors and encodes them into a buffer capped at the export limit; it never
       loads every row first.
     - The first write that would pass the cap stops reading and returns `ErrExportTooLarge`. Nothing reaches the
       client until the whole export fits.
     - `generated_at` is formatted to the whole second (fixed width).
   - `EraseAccount` (spec §6.1 step 1):
     - lock order: **the shared advisory lock first** (the key import uses), then the account row (`FOR UPDATE`), then
       the profile rows (`FOR UPDATE ORDER BY profile_id`), then the deletes. Never the account row before the
       advisory lock: that deadlocks with an import that has not inserted yet;
     - an existing record makes it a no-op;
     - a failure before COMMIT is `ErrErasureFailed`; a COMMIT error is returned as it is;
     - it runs `BeforeCommit` before COMMIT.
   - `RecordIdentityAttempt` and `AccountDeletion`.
4. **httpapi:**
   - Deps gain an `IdentityDeleter` and `BeforeIdentityDeletion`. A verifier without `SessionVerifier` makes both
     new routes refuse every request.
   - `call` gains `authTime` and `deleted`. The gate sits right after authentication: a deleted account gets `410` on
     every route except `/v1/me/deletion`.
   - Routes: `/v1/me/export` (GET) and `/v1/me/deletion` (GET; POST with `application/json` of at most 1 KiB). CORS
     follows from the route table.
   - Problems, with titles:
     - `account_deleted` 410;
     - `reauthentication_required` 401, with the RFC 9470 challenge;
     - `deletion_not_confirmed` 422, one fixed body;
     - `account_deletion_failed` 503;
     - `export_too_large` 413, written instead of any export bytes.
   - The export is written by hand, like `writePage`, so payload bytes stay verbatim.
   - The log gets fixed messages, the `deletion_id` and error classes; never a subject, token or provider text.
5. **config and server:**
   - `config`: optional `AYA_EXPORT_MAX_BYTES`, a decimal number from 1024 to 16 777 216 (default 16 777 216).
     Anything else is refused with a new guard error that names the variable. Add that error to `guardErrors` in
     `cmd/ayailmu-api/main.go`, and pass the limit through `httpapi.Deps`;
   - wire `BeforeIdentityDeletion`;
   - pass the emulator verifier as `SessionVerifier` and `IdentityDeleter`;
   - extend the `BeforeCommit` doc comment to the erasure transaction;
   - remove the "Phase 1 (RED) stub" note.
6. **Docs.** `backend/docs/Backend_Local_Contract.md`:
   - §2: the gate, and the step-up 401 beside the uniform 401;
   - §3: the routes;
   - §9: the tables;
   - §11: drop "Deletion or export routes";
   - §12: the `AYA_EXPORT_MAX_BYTES` row;
   - new §13: spec §4–§7, the export limit and the retained deletion record.
7. **Root checks:** `go vet ./...`, then `go test ./... -count=1` and `go test -race ./... -count=1`. That makes 39
   top-level tests: the 31 existing ones and these 8.

## Phase 2 — VPS and production-auth separation
Separate plan: `docs/superpowers/plans/2026-10-18-vps-compose-and-production-auth-plan.md`. It starts after
Phase 1b is reviewed and has its own red tests.

## Phase 3 — RN (`feature/rn-ux-redesign-20261017`; starts only after the backend contract is reviewed)
RED unit tests first (`app/src/**/__tests__`); no product edits before Root observes them.
1. **`api/client.ts`:** `exportAccount`, `accountDeletion` and `deleteAccount(accountId)`, which keep problem codes
   only. The `ApiRequest.method` union is unchanged; GET and POST suffice.
2. **`auth/emulatorAuth.ts`:** `reauthenticate(password)` signs the current address in again. A reply naming another
   uid is refused, and its token is dropped.
3. **`account/datasets.ts`:** `removeAccountDataset(accountId)` removes exactly `accountNamespace(accountId)`: the web
   key with its journal doc, or the native file.
   - It refuses the guest namespace and non-canonical IDs, and needs owner access.
   - Tests prove the guest dataset and another account's dataset are byte-identical afterwards.
4. **`sync/journal.ts`:** `410 account_deleted` stops the sync with a dedicated error. The frozen import stays and is
   never replayed.
5. **Export file** `ayailmu-account-export-1` (spec §8):
   - the server export verbatim, then this device's dataset and journal state, then `not_included`;
   - no token, password or email; no guest data.
6. **`AccountContext` and `AccountPanel`:**
   - export and delete entry points, a typed confirmation, and a password re-prompt;
   - the states of spec §8: 200, 202, 503, 500 or network failure, 401 after a lost answer, 410 met during sync, and
     413 `export_too_large`;
   - Indonesian copy that never claims more than the server confirmed, and names the retained deletion record.
7. **Root checks:** RN unit, type and lint checks; guest browser checks on 8088 unchanged; account browser checks
   against the private 8087, 8092 and 9099 stack.

## Done when
- the backend green tests and the RN tests pass;
- the contract doc is updated;
- deletion and export are verified in the browser with disposable synthetic accounts;
- the retention, deletion-contact and backup decisions are recorded, or still marked pending, in the contract. None of
  them is approved today, and they must be decided before any real user.
