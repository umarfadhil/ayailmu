# Account export and deletion — design (provider-independent slice)

2026-10-18 · branch `feature/local-backend-20261017` · **Status: backend GREEN implemented (provider-independent
slice plus the legacy emulator adapter); awaiting Root's vet, test and race runs. RN not started.**
Executable form: `backend/internal/server/account_controls_test.go`. The contract now lives in
`backend/docs/Backend_Local_Contract.md` (§2, §3, §9, §11, §12 and §13), and the tests win over both files.

## 1. Scope
In scope:
- server export of the signed-in account's server data;
- account deletion (server data, then the identity-provider account), with a recent sign-in and an explicit
  confirmation, both checked by the server;
- idempotent retries;
- serialization with ingest and import;
- refusing everything for a deleted account;
- honest reporting of partial failures;
- the client contract for the later RN phase (§8).

Out of scope (held or separate):
- the production identity provider. The human has since decided to avoid Google/Firebase; Root chose standalone
  Supabase Auth (GoTrue) with PostgreSQL for the next phase. Until that adapter is implemented and tested, production
  stays refused and only the legacy emulator adapter exists;
- VPS artifacts (`docs/superpowers/plans/2026-10-18-vps-compose-and-production-auth-plan.md`);
- a background retry worker, purging backups and admin tooling.

## 2. Source facts this design rests on
| Fact | Source |
|---|---|
| Every route but health authenticates, and the first request creates the account keyed by (issuer, subject). So a token still in circulation would re-create a deleted account. | `httpapi/auth.go:25-35`, `store/accounts.go:20-36` |
| `authn.Identity` has no auth_time, and a by-value comparison pins its three fields. So a new field would break a pre-existing assertion. | `authn/authn.go:45-49`, `authn_test.go:184-186` |
| Emulator verification checks revocation and that the user exists: a deleted emulator user's tokens fail. | `authn/authn.go:118` |
| `DELETE /v1/me` is pinned as 405 `Allow: GET`, and its preflight as invalid. | `startup_guards_test.go:205`, `cors_integration_test.go:193` |
| No foreign key cascades: profiles→accounts, profile_sources→profiles, events→profiles, imports→accounts and imports→profiles. | `store/migrations/0001_init.sql:15,36,40,70,77` |
| Ingest serializes on the profile row lock. Import takes a per-account advisory lock first; only then does it insert a profile and an import record, whose foreign keys key-share lock the account row, and lock the profile row. A deletion that held the account row while waiting for that advisory lock would deadlock with such an import. | `store/events.go:70-83`, `store/imports.go:88-104,126-129,190-203`, `0001_init.sql:15,70` |
| An account's size is not bounded: each import or batch is capped, but requests repeat. | `httpapi/routes.go:14-15`, `httpapi/imports.go:16` |
| `server.Options.BeforeCommit` is the deterministic barrier inside write transactions. | `server/server.go` (Options) |
| Emulator tokens are unsigned, so tests can change a claim such as `auth_time` (existing technique). | `authn_test.go:140-162` |
| RN treats any API 401 as an ended session. It keeps a frozen import on every status except 400, 404, 409 (other than `import_id_reused`), 413 and 422. | rn `auth/emulatorAuth.ts:281-291`, `sync/journal.ts:336-340` |
| RN account datasets are named by the verified account ID (`arabic-trial-app/account/<id>/v1` plus its journal doc; native `arabic-trial-account-<id>.db`). The guest dataset is separate. | rn `account/datasets.ts:22,45-52,99` |

## 3. Routes and check order
| Method and path | Needs | Answers |
|---|---|---|
| `GET /v1/me/export` | valid token, recent sign-in | `200` export (§5) · `413 export_too_large` above the export limit |
| `GET /v1/me/deletion` | valid token | `200` deletion document (§6); `404 not_found` when no deletion exists |
| `POST /v1/me/deletion` | valid token; `application/json` of at most 1 KiB; explicit confirmation; recent sign-in | `200` completed · `202` identity step pending · `503 account_deletion_failed` |

`/v1/me` keeps `GET` only. The local web app gets exact CORS preflights: export `GET`; deletion `GET, POST`.

Checks run in this order:
1. Host, CORS, authentication (the uniform 401);
2. the deleted-account gate (§6);
3. route (404), method (405), media type (415), size (413), JSON (400 `invalid_json`);
4. for `POST`: shape (400 `invalid_request`), then confirmation (422 `deletion_not_confirmed`);
5. recent sign-in (401 `reauthentication_required`);
6. the work.

Body problems come before the sign-in check, so a malformed request never sends the learner to sign in again for
nothing.

## 4. Recent sign-in and confirmation
- **Sign-in time.** Freshness uses the verified `auth_time` claim (when the user signed in), never `iat`: Firebase
  refreshes ID tokens hourly with a new `iat`, but `auth_time` stays. A sign-in is recent when
  `now − 5 min ≤ auth_time ≤ now + 60 s` on the server clock. A missing or zero `auth_time` is never recent.
- **Refusal.** `401` problem `reauthentication_required` with
  `WWW-Authenticate: Bearer realm="ayailmu", error="insufficient_user_authentication", max_age=300`. This is the
  RFC 9470 step-up challenge on an RFC 6750 bearer; no new scheme is invented.
  - The token stays valid for every other route.
  - The uniform-401 rule still covers token verification failures, which keep one byte-identical body.
  - RN's existing 401 handling ends the session and asks for a new sign-in, which is the remedy.
- **Carrying `auth_time`.** GREEN adds `authn.Session{Identity; AuthTime time.Time}` and an interface
  `SessionVerifier` with `VerifySession`. `EmulatorVerifier` implements it from the SDK token's `auth_time`.
  - `Identity` itself does not change (it is pinned by value).
  - With a verifier that lacks `VerifySession`, both routes refuse every request (fail-closed).
- **Confirmation body.** Exactly `{"confirm":"delete-account","account_id":"<the caller's account_id as GET /v1/me returns it>"}`.
  - A body of the wrong shape (a missing, extra, repeated or non-string member) gets 400 `invalid_request`.
  - Any other `confirm` value or account ID gets one identical 422 `deletion_not_confirmed`. That covers another
    account's ID, a random one and a malformed one, so the answer is no oracle.
  - Binding the account ID stops a stale screen from deleting a newer sign-in's account.

## 5. Export
`GET /v1/me/export` answers `200 application/json` with `Cache-Control: no-store`.
- **Built incrementally.** The document comes from one read-only REPEATABLE READ snapshot. Rows are read in key
  order, in pages of 64 rows (keyset paging, a cursor in effect), and encoded into a capped buffer as they arrive;
  they are never all loaded first.
- **Bounded.** The encoded body is at most `AYA_EXPORT_MAX_BYTES`. The default, which is also the maximum, is 16 MiB
  (16 777 216 bytes).
  - The setting can only lower the limit. It accepts a decimal number from 1024 to 16 777 216; anything else refuses
    to start, with an error naming the variable.
  - A body of exactly the limit is served.
  - Memory per export is bounded by the limit plus one row. Limiting concurrent exports is part of the later
    rate-limit gate.
- **All or error.** Reading stops as soon as the next bytes would pass the limit. The answer is then
  `413 export_too_large`, a problem document: 413 is a contract choice, since nothing in the request is large. No
  truncated or partial export is ever written.
- **Fixed-width `generated_at`.** It is RFC 3339 UTC in whole seconds, so the same data always encodes to the same
  length.
- **Verbatim payloads.** Payload bytes are written exactly as pull writes them.
- **Failure.** Any other failure gives the generic 500, never a partial file.
- **Larger exports: no self-service path yet.** A later design, a streamed download or an export job, must keep this
  all-or-error contract. Until then, an account over the limit needs an operator-assisted export, whose runbook and
  contact are still pending.

```json
{"format":"ayailmu-server-export-1","generated_at":"RFC 3339",
 "contents":{"included":"<fixed text: every record this service stores for the account>",
   "not_included":[
     {"what":"identity_provider_account","why":"sign-in address, password and sign-in methods are held by the identity provider"},
     {"what":"device_data","why":"guest data, answers not yet uploaded and session state stay on devices; the app adds this device's own data"},
     {"what":"credentials","why":"this service stores no password, token or key"}]},
 "account":{"account_id","created_at","issuer","subject","auth_mode"},
 "profiles":[{"profile_id","kind","created_at","revision","high_seq","settings","consent",
   "sources":[{"app","install_id","local_profile_id","linked_at"}],
   "imports":[{"import_id","created_at","request_sha256","receipt":{"…the stored receipt…"}}],
   "events":[{"seq","event_id","kind","schema","schema_version","curriculum","curriculum_status","source","semantic_sha256",
              "clock_flags","occurred_at","local_date","received_at","import_id","payload":"<exact stored bytes>"}]}]}
```

- Every stored column of the account's rows appears, and nothing of any other account.
- No token, password or email appears; the server never stores them.
- `profiles` is `[]` for an account without profiles.
- The per-request import and batch caps do not bound an account's size, because requests repeat. Only the export
  limit above bounds the export.

## 6. Deletion
### 6.1 Steps (strict order)
1. **Erase the server data**, in one transaction. Locks follow the one order every writer agrees on:
   1. **The account's advisory lock**, the key `Store.Import` takes first (`ayailmu-import:<schema>:<account_id>`).
      While an import holds it, the deletion waits holding nothing of the account. The import's next step (a profile
      or import-record insert whose foreign key key-share locks the account row, or a profile row lock) therefore
      never waits for the deletion.
   2. **Then the account row** (`FOR UPDATE`).
   3. **Then every profile row of the account** (`FOR UPDATE`, in `profile_id` order). This waits for any ingest or
      patch already holding one; those take no account-level lock, so they never wait for the deletion.
   4. Count and delete the account's events, imports, profile_sources and profiles.
   5. Insert the deletion record, run `BeforeCommit`, then COMMIT.

   Taking the account row before the advisory lock would deadlock with an import that holds the advisory lock but
   has not inserted yet.

   An existing record means step 1 already happened: go straight to step 2.

   | Failure | Answer | State |
   |---|---|---|
   | before COMMIT | `503 account_deletion_failed` ("nothing was deleted; the request can be sent again") | rolled back; the provider is not called |
   | COMMIT itself (outcome unknown) | the generic `500 internal_error` | the client reconciles with `GET /v1/me/deletion` |
2. **Delete the identity account**, only after step 1 committed:
   - run the `BeforeIdentityDeletion` seam, then `IdentityDeleter.Delete(subject)`. A "user not found" answer counts
     as deleted;
   - record the attempt: `attempts + 1`, plus `deleted_at` on success.

   | Outcome | Answer |
   |---|---|
   | success | `200` with `status: completed` |
   | failure | `202` with `status: identity_deletion_pending`, never "completed". The provider's error text is never returned, and the log gets its class only. |
   | recording fails after the provider succeeded | `500`; the record stays pending (§9) |

### 6.2 Deletion document (the `POST` answers and `GET`)
```json
{"deletion_id":"uuid","account_id":"uuid","status":"completed | identity_deletion_pending",
 "requested_at":"RFC 3339","completed_at":"RFC 3339, only when completed",
 "server_data":{"status":"erased","erased_at":"RFC 3339","profiles":0,"device_links":0,"events":0,"imports":0},
 "identity_provider":{"status":"deleted | pending","attempts":1,"deleted_at":"RFC 3339, only when deleted"},
 "not_deleted":[
   {"what":"deletion_record","why":"kept: the account ID, the identity provider's issuer and user ID (subject), the account's creation time, and this deletion's ID, times and erased counts"},
   {"what":"device_data","why":"copies on devices stay until each device removes them; the server cannot reach them"}]}
```
- A retry (a lost answer, a double tap, a later return) answers the same deletion: the same `deletion_id`,
  `requested_at` and erased counts.
- Data is never erased twice; a pending identity step is retried.
- Concurrent `POST`s serialize on the account's advisory lock and row, and each gets that same deletion.
- **Backups.** The local service keeps no backups. When the VPS phase adds backups, `not_deleted` gains a `backups`
  entry (dumps keep erased data until they expire), and the tests' expected set changes in the same step. Nothing
  ever claims that every copy is gone.

### 6.3 Nothing comes back after a deletion
- **The account row stays.** Its (issuer, subject) anchors the deletion record, so `EnsureAccount` finds it and never
  creates a new account for that identity.
- **The deleted-account gate.** Every authenticated request of that account answers `410 account_deleted`, one fixed
  body, except `GET` and `POST /v1/me/deletion`. That covers:
  - the old token;
  - a new sign-in of the same identity while its deletion is pending;
  - a replayed frozen import or upload.
- **The identity's tokens stop verifying** once the identity account is deleted (emulator: the user lookup fails),
  so they get the uniform 401.
- **Writes racing the deletion.** Every write path re-checks the deletion inside its own transaction:
  - An ingest or import already in its transaction commits first. Step 1 waits for its locks, then erases it with
    the rest.
  - A write that starts while step 1's transaction is open waits, then gets 410: import re-checks under its advisory
    lock.
  - Every profile lookup that finds no profile re-checks the account, so a request that passed authentication just
    before the commit gets 410, not 404. That covers `OwnsProfile`, `Profile`, `Ingest`, `UpdateSettings` and the
    pull and progress snapshot.

### 6.4 Deletion record and retention (a scope, not a policy)
- **This is not full erasure of identity metadata.** After a deletion the server still holds two rows for the
  account:
  - the `accounts` row: `account_id`, `auth_mode`, `issuer`, `subject` (the identity provider's user ID) and
    `created_at`;
  - the `account_deletions` row (migration `0002`): `deletion_id`, `requested_at`, the erased counts,
    `identity_attempts`, `identity_deleted_at` and `identity_last_failure_at`.

  No learning data, settings, consent, device identifiers or payloads remain. The deletion document names this
  record in `not_deleted`, and client copy must name it too.
- **Why it stays:**
  - to refuse re-creation by tokens still in circulation. Firebase ID tokens live up to 1 hour, and a verifier
    without a revocation lookup would accept them;
  - to make retries idempotent;
  - to report a pending identity step.
- **Retention: not decided, nothing approved.** No retention period, purge schedule or default has been approved.
  This slice keeps both rows until an operator purge, which does not exist yet.
  - Technical floor: purging before the identity deletion is confirmed, plus the longest token lifetime, would let a
    token still in circulation re-create the account.
  - The period, the purge mechanism and the deletion contact are human decisions, held until before any real user.
    The current scope is synthetic fixtures only.

## 7. Failure matrix
| Situation | Answer | Resulting state |
|---|---|---|
| malformed or unconfirmed request | 400 / 422 | unchanged |
| old, missing or future sign-in time | 401 `reauthentication_required` (the verifier may already refuse a missing or future one with the uniform 401) | unchanged |
| store failure while erasing | 503 `account_deletion_failed` | unchanged; the provider was not called |
| COMMIT outcome unknown | 500 `internal_error` | unknown; `GET /v1/me/deletion` tells |
| provider failure | 202 `identity_deletion_pending` | data erased, identity pending |
| retry while pending | 202, or 200 once the provider succeeds | the same deletion |
| retry after completion (lost answer) | 401 (the identity is gone) | completed |
| two `POST`s at once | the same deletion to both | one erasure |
| deletion while an import holds the account's advisory lock | it waits, holding nothing of the account | the import commits first; the deletion then erases it too |
| export larger than the limit | 413 `export_too_large` | only the problem is sent, no part of the export |
| old token, frozen-import replay, or a new sign-in while pending | 410 `account_deleted` | nothing re-created |
| any token after completion | 401 | nothing re-created |

## 8. Client contract (RN phase, after backend GREEN; its own RED/GREEN)
**Export.** «Unduh data akun» asks for the password again (a new sign-in, so `auth_time` is now), then calls
`GET /v1/me/export` and writes one file:

```json
{"format":"ayailmu-account-export-1","exported_at":"…","account_id":"…",
 "server":"<the server export, verbatim>",
 "this_device":{"dataset":"<raw records of this account's local dataset>",
   "sync":{"install_id":"…","profile_id":"…","pending_answers":["<exact envelopes>"],"frozen_imports":["…"],"cursor":0,"other_devices_answers":["…"]}},
 "not_included":[{"what":"guest_data","why":"not part of this account"},{"what":"other_devices","why":"only this device's copy is here"},
   {"what":"credentials","why":"the password and token live in memory only and are never written"}]}
```

On `413 export_too_large`, the app says three things: the account's server data is larger than the 16 MiB download
limit, nothing was downloaded, and an assisted export goes through the contact (still pending). It never builds a
partial file.

**Delete.**
1. The screen explains what goes: the server data, the sign-in account and this device's copy. Guest data stays.
   Other devices keep their copy until they are opened.
2. The learner types the confirmation, then signs in again.
3. The app sends `POST` with the `account_id` from `verify()`.

Then, by answer:

| Answer | What the app does |
|---|---|
| `200` completed, or `202` pending (server data erased either way) | Stop sync and drop the journal. Delete exactly `accountNamespace(accountId)`, only while owning its writer lock: web key and journal doc, or the native SQLite file. Never the guest namespace (the `isGuest` guard) or another account's. Sign out. On `202`, say honestly that the sign-in account is not deleted yet; signing in again gives 410 on `/v1/me` and offers «Selesaikan penghapusan». |
| 503 | Delete nothing; say that nothing was deleted. |
| 500, network failure, abort | Delete nothing; say the outcome is unknown and reconcile with `GET`. |
| 401 on that `GET` after a lost answer | Say the sign-in no longer works, which is consistent with a completed deletion; offer local removal. |
| 410 `account_deleted` during any sync | Stop. Keep the journal frozen and never replay it. Explain, and offer explicit local removal of this account only. |

A read-only tab cannot remove local data and says so. No copy claims more than the server confirmed. It names the
retained deletion record (the identity provider's user ID among it), and never promises that every identifier,
backup or other-device copy is gone.

## 9. Known limitations
- No background retry. A pending identity step completes when the user retries, or through an operator action (a
  runbook is TODO).
- Deleted data persists in backups until they expire. Restoring an older backup resurrects deleted accounts unless
  the deletions recorded after it are re-applied (VPS plan, restore runbook).
- If recording fails after the provider deleted the identity, a stale pending record is left behind for operator
  reconciliation.
- An account whose export passes the limit has no self-service export (§5).

## 10. Provider-dependent pieces
- `SessionVerifier` and `IdentityDeleter` are ports. GREEN implements only the emulator adapter for the legacy
  synthetic fixtures (Admin SDK in emulator mode: `auth_time` from `VerifyIDTokenAndCheckRevoked`, `DeleteUser`).
- Next phase (decided, not started): a standalone Supabase Auth (GoTrue) adapter behind the same ports. Its sign-in
  time must come from a verified sign-in timestamp (such as the `amr` password entry), never `iat` or a refresh; its
  deletion from the documented admin delete of the caller's own verified subject, server-side only. No new Firebase
  production work.
- Production stays refused until that adapter is implemented and tested.

## 11. Test seams
- `server.Options.BeforeIdentityDeletion func(ctx) error`: wired; runs before each identity attempt, after step 1
  committed.
- `server.Options.BeforeCommit`: extended to step 1's erasure transaction (documented on the field).
- Old, missing or future `auth_time`: unsigned emulator-format tokens with that one claim changed. An old `auth_time`
  with a fresh `iat` proves the check reads `auth_time`, not the token's age. Emulator mode only; production
  verification rejects such tokens.
- **Lock order, with no production hook.**
  - A fixture transaction takes the import's advisory lock, and `pg_locks` shows the deletion queued for it.
  - `FOR KEY SHARE NOWAIT` on the account row and `FOR UPDATE NOWAIT` on a profile row then prove the waiting
    deletion holds neither.
  - The fixture then writes a profile and commits, and the deletion erases it.
- **Export limit.** Tests set `AYA_EXPORT_MAX_BYTES` (the production setting itself), restarting the service on the
  same schema:
  - with the limit at a small export's measured size, the export is served;
  - one byte less, it is refused.

  The 16 MiB default is covered by a synthetic fixture of about 15 MiB (served) and about 18 MiB (refused), written
  straight into the test's own schema.
