# AyaIlmu local backend: HTTP contract (v1)

Local-only and synthetic. The service runs against a loopback or Unix-socket PostgreSQL in one of two
local modes: the local synthetic Supabase mode (§14), against one explicitly configured Supabase Auth
(GoTrue v2.197.0) on literal loopback, or the legacy emulator mode, against the loopback Firebase Auth
emulator (demo project), which only a build with the `firebase_emulator` tag includes (§12.1). It
serves synthetic adult profiles only.
`backend/internal/server/*_test.go` is the executable form of this document; where they differ, the
tests win and this file is corrected.

**Status:** implemented, local only. That covers the configuration, verifier and store guards; the
schema migrations; every §3 route (health, account, curriculum metadata, profile read and patch, guest
import, event upload, pull and progress) behind the §2 guards; the account export and deletion (§13);
the client journal (§10); and the `backend/cmd/ayailmu-api` command (§12).

The account export and deletion (§13) are the GREEN slice of 2026-10-18. Their tests are in
`backend/internal/server/account_controls_test.go`; this document records the implementation, and the
tests win where the two differ.

The local synthetic Supabase mode (§14) is the Phase 4 slice of 2026-10-19. Its tests are
`backend/internal/config/local_supabase_test.go` and `backend/internal/server/local_supabase_test.go`,
the latter partly against a real pinned GoTrue fixture.

The Firebase build isolation is the Phase 6 slice of 2026-10-19. A default build has no Firebase Auth
emulator support: `server.New` refuses emulator mode with `authn.ErrEmulatorDisabled` before it opens
the store (`backend/internal/server/emulator_disabled_test.go`). The legacy emulator verifier and the
emulator-dependent tests build only with `-tags firebase_emulator` (§12.1).

The deploy modes, the migration job and the container probe (§15) are the Phase 8 slice of 2026-10-19,
for the local synthetic Compose stack in `deploy/` and a deny-all smoke verifier. Neither mode is
production, which stays refused.

## 1. Startup (fails closed)
`server.New` applies, in order:
1. the `config` guards. In every mode: production refused; loopback listen; no
   `GOOGLE_APPLICATION_CREDENTIALS`; database hosts named in the string; an `AYA_EXPORT_MAX_BYTES`, if
   set, from 1024 to 16 777 216. In emulator mode: a `demo-` project and a loopback emulator host. In
   local-supabase mode: the Auth URL, the issuer, the audience and the admin credential file (§12, §14);
2. the verifier guards. In emulator mode, a default build refuses with `authn.ErrEmulatorDisabled`
   (§12.1), and in a `firebase_emulator` build the process `FIREBASE_AUTH_EMULATOR_HOST` must equal the
   configured emulator. In local-supabase mode, the Supabase verifier's own URL and setting guards
   (`authn.ErrUnsafeConfig`), then one fetch of Auth's `/.well-known/jwks.json` that must yield a usable
   key set (`authn.ErrKeySetUnavailable`). Without one the service does not start, and no schema is
   created;
3. the store guard: `store.ParseConfig` lets pgx parse the URL (including PG* variables and service
   files), then refuses unless the primary host **and every fallback** is a literal loopback IP or a
   Unix socket directory (`ErrDatabaseNotLocal`). Nothing is opened before this passes.

Then it migrates the schema (`AYA_DB_SCHEMA`, default `ayailmu`). No socket is bound until
`ListenAndServe`.

## 2. Rules for every request
Checks run in this order: Host, the CORS gate, authentication, the deleted-account gate, route,
method, media type, size, JSON, then the route's own checks.

- **Host:** must equal `AYA_LISTEN` or `localhost:<port>`. Anything else → `421 host_not_allowed`,
  with no CORS headers.
- **Cross-origin requests:** only the local web app, at exactly `http://localhost:8087` or
  `http://127.0.0.1:8087`, gets a CORS grant. There is never a wildcard and never
  `Access-Control-Allow-Credentials`: the API takes bearer tokens, not cookies.
  - A preflight is an `OPTIONS` request with an `Origin` and an `Access-Control-Request-Method` header,
    even an empty one. `OPTIONS` without either is an ordinary request.
  - A web origin asking for a known route, one of its methods in exact case, and request headers only
    among `Authorization`, `Content-Type` and `If-Match` (any case) gets `204` with no body. The response
    carries the exact `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods` (the route's methods,
    as in `Allow`), `Access-Control-Allow-Headers: Authorization, Content-Type, If-Match`,
    `Access-Control-Max-Age: 600` and `Vary` on `Origin` and both preflight request headers.
  - Any other origin → `403 origin_not_allowed`. A web origin asking for an unknown route, another
    method, or another request header → `403 invalid_preflight`. Refusals grant nothing and quote
    nothing from the request.
  - Any other request goes through the usual checks unchanged: a bearer token is still required, and
    the 401 body is the same. From a web origin, every answer, errors included, also carries the exact
    `Access-Control-Allow-Origin`, `Vary: Origin` and `Access-Control-Expose-Headers: ETag`, so the web
    app can read 401, 412 and 428 bodies and the profile's `ETag`. A missing or other origin gets no CORS
    headers.
- **Authentication:** every route except `/v1/healthz` needs exactly one `Authorization: Bearer
  <token>` header, verified by the configured mode's verifier: an access token of the configured
  Supabase Auth (§14) or, in a `firebase_emulator` build's emulator mode, a Firebase ID token.
  Anonymous sign-ins are refused.
  - Any failure → `401 unauthenticated` with `WWW-Authenticate: Bearer realm="ayailmu"`.
  - The 401 header and body are byte-identical whatever the cause.
  - The one other 401 is the step-up challenge `reauthentication_required` (§13): a valid token whose
    sign-in is too old for an export or a deletion. That token stays valid for every other route.
- **Accounts:** the first authenticated request creates the account, keyed by `(issuer, subject)`. No
  email, name, phone or photo is stored.
- **Deleted accounts:** every authenticated request of an account whose deletion is recorded gets one
  fixed `410 account_deleted`, on every route, unknown ones included, except `GET` and `POST
  /v1/me/deletion` (§13). The account row stays, so no token of that identity creates a new account.
- **Responses:** every response sends `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  - Success bodies are `application/json`.
  - Errors are `application/problem+json` (RFC 9457): `{"type","title","status","code","detail"}`,
    where `code` is stable and `type` is `urn:ayailmu:problem:<code>`. Problems never echo request
    content.
- **Routes and methods:** an unknown route → `404 not_found`. A known route with the wrong method →
  `405 method_not_allowed`, with `Allow` listing the methods in sorted order, comma-separated.
- **Media types:** `POST` bodies need `application/json`; `PATCH` needs
  `application/merge-patch+json`. Otherwise → `415 unsupported_media_type`.
- **Body limits:** events batch 4 MiB; import 16 MiB; profile patch 16 KiB; deletion request 1 KiB →
  `413 body_too_large`.
- **Malformed bodies:** malformed JSON → `400 invalid_json`. Valid JSON in the wrong shape (unknown or
  missing members, wrong types) → `400 invalid_request`.
- **Profile IDs:** another account's profile, a random UUID and a malformed ID all get the same
  `404 not_found` body.

## 3. Routes

| Method and path | Result |
|---|---|
| `GET /v1/healthz` | `200 {"status":"ok","mode":"local-supabase"}` (`"emulator"` in a `firebase_emulator` build's emulator mode), no token |
| `GET /v1/me` | `200 {"account_id","profiles":[{"profile_id","revision","high_seq"}]}` |
| `GET /v1/curricula` | `200 {"families":[…],"packs":[…]}`: the curriculum registry exactly, metadata only |
| `POST /v1/imports` | guest import or link; the only way a profile is created (§5) |
| `GET /v1/profiles/{pid}` | `200` profile document, `ETag: "r<revision>"` |
| `PATCH /v1/profiles/{pid}` | conditional merge patch of `settings` (§4) |
| `POST /v1/profiles/{pid}/events` | batch ingest (§6) |
| `GET /v1/profiles/{pid}/events` | pull by cursor (§7) |
| `GET /v1/profiles/{pid}/progress?family=` | factual counts (§8) |
| `GET /v1/me/export` | the account's server export, after a recent sign-in (§13) |
| `GET /v1/me/deletion` | the account's deletion document, or `404` when none exists (§13) |
| `POST /v1/me/deletion` | delete the account, after an explicit confirmation and a recent sign-in (§13) |

`/v1/me` itself keeps `GET` only.

### Curriculum metadata
`GET /v1/curricula` returns:
- each family's name, app, schema, schema versions and approved review status;
- each pack's family, track, content version and lifecycle;
- each pack's source: repo, path, SHA-256, format, `answer_format` (`mcq4` means four-choice
  recognition) and `meta_schema_version`;
- each pack's synthetic flag, review-status counts, `reviewed_production_content` and note.

It never returns item content, prompts, options, answer keys or any mastery field. Every pack
registered today is synthetic and has `reviewed_production_content: false`.

## 4. Profiles
The profile document:

```json
{"profile_id":"uuid","kind":"adult","revision":1,"high_seq":0,
 "settings":{"instruction_lang":"id","session_minutes":10,"arabic_scale":1.0},
 "consent":{"version":"trial-consent-1","at":"2026-10-15T00:00:00Z"},
 "sources":[{"app":"expo","install_id":"inst-…","local_profile_id":"lrn-…"}]}
```

No label, name, birth year, email or phone exists anywhere in it.

`PATCH` rules:
- **Preconditions** are checked after the shared §2 guards, so a wrong media type, an oversized body or
  malformed JSON still gets `415`, `413` or `400 invalid_json`. Then the profile is looked up (404),
  then the preconditions, and only then the patch content is validated.
  - Without a usable `If-Match` → `428 precondition_required`. A usable one lists one or more strong
    revision tags such as `"r3"`; `*`, weak or malformed tags count as missing.
  - No listed tag names the current revision → `412 revision_conflict`; the problem carries
    `"current": <document>` and the current `ETag`.
- **What may change:** only `settings` members, with RFC 7396 semantics: `null` removes a setting, and
  `"settings": null` removes them all.
  - `instruction_lang` is `id` or `en`.
  - `session_minutes` is an integer literal from 1 to 240.
  - `arabic_scale` is a number from 0.8 to 2.0.
  - Any other value, or an unknown settings member → `422 invalid_profile_patch`.
- **Refused members:** `kind`, `consent`, `sources`, `revision`, `high_seq`, `profile_id` and any
  identifying member → `422 profile_field_not_patchable`. A body that is not an object →
  `400 invalid_request`.
- **Revisions:** success → `200` with the new document and `ETag`. The revision increases only when a
  value actually changes.
- **Events never touch the profile:** event uploads and imports into an existing profile never change
  its revision or settings. A device that loses a race must re-read and re-apply explicitly; there is
  no silent last-writer-wins.

## 5. Guest import: `POST /v1/imports`

```json
{"import_id":"imp-<uuid persisted before the first attempt>",
 "source":{"app":"expo","install_id":"inst-…","local_profile_id":"lrn-…"},
 "target":{"new_profile":{"kind":"adult","settings":{…},"consent":{"version":"…","at":"RFC 3339"}}}
        | {"profile_id":"uuid"},
 "events":[ envelope v1, … ]}
```

- **Size limits:** at most 10,000 events (more → `413 batch_too_large`) in 16 MiB. The `events` array
  may be empty, which simply links a device.
- **Request hash:** SHA-256 of the canonical (aya-cjson-1) request, so a retry spelled differently
  still matches. A body that cannot be canonicalized (an event with invalid UTF-8 or a duplicate key)
  cannot match any stored import. Its replay check is skipped, and the offending event is reported like
  any other invalid event. Malformed JSON → `400 invalid_json`; a wrapper of the wrong shape →
  `400 invalid_request`.
- **Request checks**, made before the database:
  - The body has exactly `import_id` (a string), `source` and `target` (objects) and `events` (an
    array); otherwise `400 invalid_request`. Invalid UTF-8 or a repeated member name outside the events
    → `400`.
  - `import_id` follows the event ID rule; the source's `app` is `expo` or `android` and its IDs are
    1 to 128 bytes. Otherwise `422 invalid_import`.
- **Replay before event checks:** whenever the request can be canonicalized, the replay check runs
  before the events are checked. So a reused `import_id` with different content is
  `409 import_id_reused` even if one of its events is invalid. The events are checked next (the §6
  rules, then the source). A request that cannot be canonicalized skips the replay check, as the
  Request hash rule says.
- **Replay:** the same `import_id` with the same hash → `200` with the stored receipt and
  `"replayed": true`. The same `import_id` with a different hash → `409 import_id_reused`.
- **Target resolution:** the account's existing mapping for `(app, install_id, local_profile_id)` wins,
  so a lost `import_id` cannot create a second profile. An explicit `profile_id` that conflicts with
  that mapping → `409 source_already_linked`. Another account's profile, one that does not exist, or a
  malformed ID → `404 not_found`.
- **New profiles:** `new_profile.kind` other than `adult` → `422 unsupported_profile_kind`. Unknown or
  identifying members (label, birth year, email, …) or missing consent → `422 invalid_import`. Any NUL
  in the import ID, source or consent text → `422 nul_in_indexed_text`.
  - `settings` is optional and follows the §4 rules.
  - `consent` is `{"version": 1 to 128 bytes, "at": an RFC 3339 date-time with offset}`.
- **Events:** each event must come from the import's source (`app`, `install_id`,
  `local_profile_id`).
- **All or nothing:** the import runs in one transaction. If any event is invalid (422), conflicts
  (409) or comes from another source (409 `source_not_linked`), nothing is written: no profile, link,
  event or import row. The response is then a problem `import_rejected`, with status 422 if any event
  is invalid and otherwise 409. Its `results` list only the failing events, as
  `{index, event_id, result, status, code, detail}`, where `result` is `invalid` (422), `conflict`
  (409 `event_conflict`, adding `seq`, `stored_sha256` and `received_sha256`) or `unlinked`
  (409 `source_not_linked`). `event_id` is omitted when it is not a well-formed event ID.
- **Receipt:** success → `201` with:

  ```json
  {"import_id","profile_id","profile_created","replayed":false,"stored","identical","high_seq",
   "event_ids_sha256","committed_at"}
  ```

  `event_ids_sha256` is the lowercase hex SHA-256 of every event ID in the request, repeats included,
  sorted bytewise and joined by `\n`. A device marks its rows synced only when the counts and this
  checksum match its local set.
  Payloads keep the guest's own `learner_id`; server IDs are never derived from guest IDs.

## 6. Events: `POST /v1/profiles/{pid}/events`
- **Order:** after the §2 guards, the profile is resolved (404), then the batch shape is checked, then
  each event, and finally one transaction stores the batch under the profile row lock.
- **Body:** `{"events":[envelope v1, …]}`, 1 to 500 events. An empty batch or other members →
  `400 invalid_request`. More than 500 events → `413 batch_too_large`.
- **Splitting:** the batch is split on JSON syntax only. Each element is validated alone by
  `envelope.Parse`, so invalid UTF-8 or a duplicate key inside one envelope gets a per-event
  `422 invalid_json` or `duplicate_key`.
- **NUL rule:** before any database access, an event whose relationally indexed text contains U+0000
  gets a per-event `422 nul_in_indexed_text`. That text is the curriculum's family, track,
  `content_version` and `rules_version`, and the source's app, `install_id`, `app_version` and
  `local_profile_id`. The payload is stored as its exact text, so escaped NUL, raw Unicode and every
  other byte inside it come back unchanged.
- **Linking:** if any valid event's source is not linked to `pid` for this account, the whole batch is
  refused as `409 source_not_linked` and nothing is stored.
- **Response:** otherwise `200 {"results":[…],"high_seq":N}`, with one result per input, in order:

| `result` | `status` | Fields |
|---|---|---|
| `stored` | 201 | `index, event_id, seq, received_at, semantic_sha256, curriculum_status, clock_flags` |
| `identical` | 200 | the original `seq`, `received_at`, `semantic_sha256`, `curriculum_status`, `clock_flags` |
| `conflict` | 409 | `code: event_conflict`, `seq`, `stored_sha256`, `received_sha256`; the stored row is untouched |
| `invalid` | 422 | `code` (an envelope code or `nul_in_indexed_text`), `detail` |

- **Identity:** `(profile, event_id)`. Same ID and same semantic hash means identical; the hash ignores
  transport, so a retry from an upgraded app is identical. The first accepted copy, payload bytes and
  source included, is kept forever.
- **Ordering:** `seq` is assigned per profile under the profile row lock, so it is gapless and follows
  commit order. A transaction that commits later can never get a smaller `seq` than one already
  visible.
- **Unknown versions:** an unknown track or content version of a known family is stored as
  `curriculum_status: unregistered`. It is never dropped, and progress leaves it out.
- **Clock flags** are recorded and never cause rejection:
  - `future_skew`: occurred more than 10 minutes after receipt;
  - `local_date_far`: the local date is outside the UTC dates of `occurred_at` − 12 h to + 14 h;
  - `pre_2020`.

  Flags are listed in sorted order.

## 7. Pull: `GET /v1/profiles/{pid}/events?after=&limit=&family=`
- **Parameters:**
  - `after` is an integer ≥ 0 (default 0).
  - `limit` is from 1 to 500 (default 100).
  - `family`, if given, must be registered.
  - `after` and `limit` are plain decimal digits. Any other value, and any unknown or repeated
    parameter → `400 invalid_query`. The profile is resolved (404) before the query is checked.
- **Response:**

  ```json
  {"events":[{"seq","event_id","kind","schema","schema_version","curriculum":{…},"curriculum_status",
     "source":{…},"semantic_sha256","clock_flags","received_at","payload":<exact stored bytes>}],
   "next_after":N,"high_seq":N,"has_more":bool}
  ```

- **Cursor:** `next_after` is the last returned `seq`, or `after` when nothing is returned. `high_seq`
  counts committed events of every family. Unregistered events are pulled like any other.
- **Snapshot:** `high_seq` and the events are read from one committed snapshot, which never waits for
  a writer. An upload that has not committed is invisible, and it can never take a lower `seq` than
  one already visible, so a cursor never skips a late commit.
- **Payload bytes:** each `payload` is the stored text written verbatim into the response, so
  whitespace, escapes, number spellings and raw Unicode come back exactly as the first accepted copy
  sent them.

## 8. Progress: `GET /v1/profiles/{pid}/progress?family=<registered family>`
These are factual counts over the family's registered events, in learning order `(occurred_at,
event_id)`. Every other family is left out entirely. A missing or unknown family →
`400 invalid_query`.

```json
{"profile_id","family","as_of_seq","derivation":"factual-counts-v1",
 "learned":{"status":"not_assessed_by_server"},"retention":{"status":"not_assessed_by_server"},
 "events","excluded_unregistered","clock_flagged","source_installs",
 "skills":[{"skill","events","by_outcome","by_role_or_pool","evidence_modes","distinct_exposure_keys",
            "local_days","fresh_claims","fresh_claims_contradicted"}],
 "versions":[{"track","content_version","rules_version","events",
              "pack":{"lifecycle","synthetic","reviewed_production_content","answer_format","note"}}],
 "provenance":{"synthetic":{"true","false","absent","unknown"},"feedback_deferred":{…},"hint_used":{…},
               "retention_valid_false"}}
```

- **Count maps:** `by_outcome`, `by_role_or_pool` and `evidence_modes` list observed values only.
  - `by_role_or_pool` uses `role`, falling back to `pool`.
  - A record without an evidence mode counts under `absent`.
  - The exposure key is `lineage`, falling back to `item_id`.
  - A fresh claim counts as contradicted when an earlier event has the same `item_id` or `lineage`.
- **Provenance buckets:** always `true`, `false`, `absent` and `unknown`. `unknown` means present but
  not a boolean; the Expo store does not type-check `synthetic` or `feedback_deferred`. An omitted
  Kotlin default is `absent`. Neither is ever counted as false.
- **Nothing is inferred:** no mastery, readiness, learned state or retention is derived. Pack caveats
  come from the registry verbatim.
- **How it is read:** `family` is the only parameter; a missing or unknown family, or any other
  parameter → `400 invalid_query`. Each event's facts are read with `envelope.Parse`, the code that
  accepted it, from its stored fields and exact payload; no stored record is changed. Each `versions`
  entry is one `(track, content_version, rules_version)`, and its `pack` repeats the registry's
  lifecycle, synthetic flag, review state, answer format and note.

## 9. Storage
- **Tables:** `accounts`, `profiles`, `profile_sources`, `events` and `imports` (migration `0001`),
  and `account_deletions` (migration `0002`, §13), in `backend/internal/store/migrations`. Migration
  `0003` lets `accounts.auth_mode` be `local-supabase` as well as `emulator`. Payloads are stored as
  `text` (exact bytes, never `jsonb`). No foreign key cascades.
- **Accounts** are keyed by the verified `(issuer, subject)` alone. An account records the mode that
  created it as `auth_mode`, which never changes. Nothing matches an account by email or carries one
  across modes: an emulator account and a local-supabase account are always different accounts.
- **Migrations:** idempotent and serialized per schema.
- **Durability claim:** a service or store restart preserves everything. That is tested by reopening
  against a running PostgreSQL. No PostgreSQL crash or restart durability is claimed.

## 10. Client journals (`backend/internal/journal`)
A journal is a stand-alone durable device store used to exercise real sync. The Expo and Android apps
are unchanged. One JSON file per device, mode 0600, keeps:
- the device identity, checked on every reopen;
- the local originals: exact envelope bytes, never deleted. Each must pass `envelope.Parse`, belong to
  the device's family and source, have no NUL in its indexed text and fit in 1 MiB. A repeat with the
  same content is kept as another original; the same ID with other content is refused;
- which originals the server has acknowledged (the rest is the outbox);
- the import ID and the frozen import request;
- the linked profile and its settings base (the server's revision and settings);
- the pull cursor, and the events pulled from other devices with their exact payload bytes;
- local settings and consent;
- an opaque local session state that is never uploaded.

Every change is written to a new file, synced and renamed over the journal, so a crash leaves the old
or the new state. Byte fields are stored as base64, losslessly. Bearer tokens are never stored: a
`Client` carries one per call. Its base URL must be a loopback `http` address without credentials,
path, query or fragment, and redirects are never followed. Errors never quote a token, a request body
or response text.

`Sync` runs these steps:
1. **Link.** The first link is the device's guest import (§5). It is frozen before it is first sent:
   an import ID and the exact request bytes. The request carries the unacknowledged originals of that
   moment, within the import limits, and either the target profile (`LinkProfileID`, with no settings
   or consent) or a new adult profile with the local settings and consent of that moment.
   - Every retry sends those bytes unchanged, after a lost response or a reopen, whatever was recorded
     or edited since.
   - A receipt is accepted only if all of these match: its import ID, its status (201, or 200 for a
     replay), its counts (`stored + identical` equals the events sent), its checksum over every event
     ID sent, repeats included, and, for a link, its profile. Otherwise nothing is acknowledged or
     linked.
   - A refusal that proves nothing was written (400, 404, 409 other than `import_id_reused`, 413 or
     422) drops the frozen request, so a later sync builds a new one with a new import ID.
2. **Base.** Right after linking, the device reads the profile once; its revision and settings become
   the settings base. Local settings are never overwritten.
3. **Upload.** Originals recorded after the frozen import go up only once the link is saved, as exact
   bytes in batches within the §6 limits. An event is acknowledged only by a `stored` or `identical`
   result with its own ID and hash. A conflict or any other result leaves it pending; a conflict's ID
   is listed in `SyncReport.Conflicts`, and `Sync` returns `ErrUnacknowledged` after pulling.
4. **Pull.** Only the device's family, page by page from the cursor. Each page is checked (family, app,
   increasing `seq`, `next_after`) and saved with the new cursor before the next one is requested. The
   cursor follows `next_after`, never `high_seq`. The device's own events stay among its originals;
   other devices' events are kept once each, with their exact payload bytes.

`Sync` never changes the local settings, the session state or, once captured, the settings base.

Settings go out only through `PushSettings`: an RFC 7396 patch of the members that differ from the base
(null removes one), conditional on the base revision. When nothing differs, nothing is sent. Success
makes the returned profile the new base.
- A stale base fails with `SettingsConflict`, carrying the server's current revision and settings. The
  local settings and the base stay as they were; there is no automatic merge.
- `RebaseSettings(conflict)` resolves it explicitly: the server's revision and settings become the base.
  The next `PushSettings` then sends exactly the members the local settings still change, or nothing
  after `SetSettings(conflict.Server)`.

`TestTwoDeviceJournalsReplayDurably` is the reproducible two-device demonstration:
- a committed import whose response is lost, replayed after a reopen;
- a second device linking with no events;
- offline answers on both devices converging;
- an Android device in the same profile kept apart from the Expo family;
- the service and both journals reopened with pending answers, session states, cursors and pulled
  bytes intact;
- an explicit settings conflict;
- no session state on the server.

`TestJournalRetriesFrozenImportAfterLostResponse` covers the frozen import and the receipt checks.
Reopening runs against a PostgreSQL that keeps running; no database crash or restart is claimed.

## 11. Not available in this slice
- Production authentication or mode (refused at startup). The local-supabase mode is local and
  synthetic only (§14).
- In local-supabase mode, any recovery of a provider deletion whose success answer was lost: that is left
  to operator reconciliation, and no background retry exists (§13.5, §14).
- Session snapshots (no route, never merged).
- `screen_view` and `item_report` events (`422 unsupported_kind`).
- Support purchases and mock-store routes (404).
- Child profiles.
- A self-service export larger than the export limit, a background retry of a pending identity
  deletion, and any purge of deletion records (§13).
- Server-side mastery, readiness or retention.
- Any cloud, real email, payment or deployment.

## 12. Running locally
`backend/cmd/ayailmu-api` runs the service. It reads its settings from the environment, applies every
guard, migrates the schema and serves on the loopback address until interrupted (SIGINT or SIGTERM).

| Variable | Value |
|---|---|
| `AYA_MODE` | `local-supabase`, or `emulator` in a `firebase_emulator` build only (a default build refuses it, §12.1); `production` is refused |
| `AYA_LISTEN` | optional; a literal loopback `host:port`, default `127.0.0.1:8091` |
| `AYA_DATABASE_URL` | a loopback or Unix-socket PostgreSQL URL, supplied privately; never committed or logged |
| `AYA_DB_SCHEMA` | optional; default `ayailmu` |
| `AYA_FIREBASE_PROJECT_ID` | emulator mode: a `demo-` project, such as `demo-ayailmu` |
| `FIREBASE_AUTH_EMULATOR_HOST` | emulator mode: the local Auth emulator, such as `127.0.0.1:9099` |
| `AYA_SUPABASE_URL` | local-supabase mode: Auth's base URL, `http` or `https` on a literal loopback IP with an explicit non-zero port, with no userinfo, query or fragment; a path is allowed |
| `AYA_SUPABASE_ISSUER` | local-supabase mode: the exact `iss` of Auth's tokens, 1 to 256 bytes of visible ASCII; it need not match the URL |
| `AYA_SUPABASE_AUDIENCE` | local-supabase mode: the exact `aud` of Auth's tokens, 1 to 256 bytes of visible ASCII |
| `AYA_SUPABASE_ADMIN_KEY_FILE` | local-supabase mode: the absolute path of a private file holding the server-only admin credential (§14) |
| `AYA_EXPORT_MAX_BYTES` | optional; lowers the account export limit (§13). Plain decimal bytes from 1024 to 16777216, default 16777216 (16 MiB); anything else refuses to start |

`GOOGLE_APPLICATION_CREDENTIALS` must be unset in every mode. Local-supabase mode does not read the
Firebase variables. With these variables set privately, run `go run ./cmd/ayailmu-api` from
`backend/` (emulator mode needs `go run -tags firebase_emulator ./cmd/ayailmu-api`, §12.1). The log
names the mode it serves, a refused setting, a listen failure's system error, a fixed key-set reason,
the fixed emulator refusal of a default build or an error class. It never prints the database URL, an
admin credential, a path, a token or request content. Account deletions log fixed messages, the
`deletion_id` and error classes only: never a subject, a token or a provider's message.

### 12.1 Builds and tests
A default build has no Firebase Auth emulator support. The only code that uses the Firebase Admin SDK,
`backend/internal/authn/emulator.go` and `backend/internal/server/emulator.go`, carries the
`firebase_emulator` build tag. A default build's `newEmulatorVerifier`
(`backend/internal/server/emulator_disabled.go`) refuses emulator mode with `authn.ErrEmulatorDisabled`
before the store is opened, never falling back to another verifier, and the command logs that fixed
reason.

| Build | Command (from `backend/`) | Modes |
|---|---|---|
| default | `go run ./cmd/ayailmu-api` | local-supabase; emulator refused |
| legacy | `go run -tags firebase_emulator ./cmd/ayailmu-api` | local-supabase and emulator |

Two test suites, neither of which skips a test:
- **Default suite:** `go test ./...` and `go vet ./...`.
  - It needs `AYA_TEST_DATABASE_URL` and the pinned real GoTrue fixture (`AYA_REAL_AUTH_FIXTURE`), not
    the Firebase emulator.
  - It holds the config, curriculum, envelope and Supabase verifier tests, and the local-supabase and
    real GoTrue server tests.
  - It also holds `TestDefaultBuildRefusesFirebaseEmulatorMode` (`//go:build !firebase_emulator`),
    which only this suite compiles.
- **Legacy suite:** `go test -tags firebase_emulator ./...` and `go vet -tags firebase_emulator ./...`.
  - It runs every untagged test plus the emulator-dependent ones: `authn_test.go` and the server tests
    that use the local Auth emulator (`FIREBASE_AUTH_EMULATOR_HOST`).
  - It leaves out the default-build guard.

The test helpers both suites share carry no tag and import no Firebase SDK: `harness_test.go`,
`account_helpers_test.go` and `authn/helpers_test.go`.

`go.mod` and `go.sum` still list `firebase.google.com/go/v4`, `google.golang.org/api` and the Google
Cloud modules they need, with unchanged versions, because the `firebase_emulator` build still imports
them. Module metadata alone does not link a package into a binary. To see what the default build links,
check `go list -deps ./cmd/ayailmu-api` and `go version -m` on a default binary. Nothing here makes the
service ready for production, which stays refused.

## 13. Account export and deletion
Design: `docs/superpowers/specs/2026-10-18-account-export-deletion-design.md`. The routes are served
only with a verifier that reports the verified sign-in time (both the emulator and the Supabase verifier
do), and deletion also needs an identity deleter. Without them the routes do not exist (`404`), so they
fail closed.

| Method and path | Needs | Answers |
|---|---|---|
| `GET /v1/me/export` | valid token; recent sign-in | `200` export · `401 reauthentication_required` · `413 export_too_large` |
| `GET /v1/me/deletion` | valid token | `200` deletion document · `404 not_found` when none exists |
| `POST /v1/me/deletion` | valid token; `application/json` of at most 1 KiB; explicit confirmation; recent sign-in | `200` completed · `202` identity deletion pending · `503 account_deletion_failed` · `500` when the outcome of the erasure's COMMIT is unknown |

The local web app gets exact CORS preflights: export `GET`; deletion `GET, POST`.

**Check order:** Host, CORS, authentication (the uniform 401), the deleted-account gate (`410`), route
(`404`), method (`405`), media type (`415`), size (`413`), JSON (`400 invalid_json`). For `POST`: shape
(`400 invalid_request`), then confirmation (`422 deletion_not_confirmed`). Then the recent sign-in
(`401 reauthentication_required`), then the work. Body problems come first, so a malformed request never
sends the learner to sign in again for nothing.

### 13.1 Recent sign-in and confirmation
- **Sign-in time.** In emulator mode, the verified `auth_time` claim (when the user signed in with a
  credential). In local-supabase mode, the timestamp of the verified token's `amr` password entry. It is
  never `iat` or a refresh: a token refresh renews `iat` and keeps the sign-in time. It is recent when
  `now − 5 min ≤ auth_time ≤ now + 60 s` on the server clock. A missing sign-in time is never recent.
- **Refusal.** `401 reauthentication_required` with
  `WWW-Authenticate: Bearer realm="ayailmu", error="insufficient_user_authentication", max_age=300`:
  the RFC 9470 step-up challenge on the RFC 6750 bearer scheme. The token stays valid elsewhere, and
  every token verification failure keeps the uniform 401.
- **Ports.** `authn.SessionVerifier` (`VerifySession` → `Session{Identity, AuthTime}`) and
  `authn.IdentityDeleter` (`DeleteIdentity`) are separate from `authn.Identity`, which is compared by
  value and unchanged. `EmulatorVerifier` (in `firebase_emulator` builds only, §12.1) implements both
  for the legacy synthetic fixtures only: the
  Admin SDK's `auth_time` from `VerifyIDTokenAndCheckRevoked`, and `DeleteUser`. `SupabaseVerifier`
  implements both for local-supabase mode: the password `amr` time, and the admin API's hard delete
  (`DELETE /admin/users/{id}`, where only `200 {}` or a precise `404 user_not_found` counts as deleted).
- **Confirmation.** Exactly `{"confirm":"delete-account","account_id":"<account_id as GET /v1/me
  returns it>"}`. A missing, extra, repeated or non-string member is `400 invalid_request`. Any other
  `confirm` value or account ID, another account's included, gets one identical
  `422 deletion_not_confirmed`.

### 13.2 Export
`200 application/json`, `Cache-Control: no-store`, with `Content-Length`:

```json
{"format":"ayailmu-server-export-1","generated_at":"RFC 3339 UTC, whole seconds",
 "contents":{"included":"…","not_included":[{"what":"identity_provider_account","why":"…"},
   {"what":"device_data","why":"…"},{"what":"credentials","why":"…"}]},
 "account":{"account_id","created_at","issuer","subject","auth_mode"},
 "profiles":[{"profile_id","kind","created_at","revision","high_seq",
   "settings":{"instruction_lang","session_minutes","arabic_scale"},"consent":{"version","at"},
   "sources":[{"app","install_id","local_profile_id","linked_at"}],
   "imports":[{"import_id","created_at","request_sha256","receipt":{…the stored receipt…}}],
   "events":[{"seq","event_id","kind","schema","schema_version","curriculum","curriculum_status","source",
     "semantic_sha256","clock_flags","occurred_at","local_date","received_at","import_id",
     "payload":<exact stored bytes>}]}]}
```

- **One snapshot, read incrementally.** One read-only REPEATABLE READ transaction. Profiles, device
  links, imports and events are each read in key order (`profile_id`; `app, install_id,
  local_profile_id`; `import_id`; `seq`), in pages of 64 rows, and each row is encoded as it arrives.
  Nothing loads every row first, and a stop leaves at most the rest of one page unread.
- **Bounded, all or error.** The encoded body is at most `AYA_EXPORT_MAX_BYTES` (default and maximum
  16 MiB; the setting can only lower it). It is collected in 64 KiB chunks, so memory stays within the
  limit plus one chunk and one row. A body of exactly the limit is served. As soon as the next bytes
  would pass it, reading stops and the answer is `413 export_too_large`, a problem that carries no part
  of the export. 413 is a contract choice: nothing in the request is large.
- **Exact.** Every stored column of the account's rows, and nothing of any other account. Unset
  settings are `null`. Payloads are the stored bytes, verbatim; each receipt is the stored receipt. No
  token, password or email appears; the service stores none. `profiles` is `[]` for an account without
  profiles. `generated_at` has a fixed width, so the same data always has the same length.
- **Any other failure** is the generic `500`, never a partial export. The response carries
  `Content-Length`: a transfer cut short (for example by the server's 60 s write timeout on a very slow
  link) is never a shorter valid document.
- **Larger accounts** have no self-service export yet; an operator-assisted export, its runbook and its
  contact are pending.

### 13.3 Deletion
**Step 1, erase the server data**, in one READ COMMITTED transaction (`store.EraseAccount`). The locks
follow the one order every writer agrees on:
1. the account's advisory lock, the one `Store.Import` takes first (`ayailmu-import:<schema>:<account_id>`).
   While an import holds it, the erasure waits holding nothing of the account, so the import's next
   step (an insert that key-share locks the account row, or a profile row lock) never waits for it;
2. the account row (`FOR UPDATE`);
3. every profile row of the account, in `profile_id` order (`FOR UPDATE`), which waits for an ingest or
   settings update holding one. Those take no account-level lock, so they never wait for the erasure.

Then the account's events, imports, device links and profiles are deleted and counted, the
`account_deletions` row is inserted, `BeforeCommit` runs, and the transaction commits. A recorded
deletion found under the advisory lock means step 1 already happened: nothing is erased twice.

| Failure | Answer | State |
|---|---|---|
| before COMMIT | `503 account_deletion_failed` ("nothing was deleted; the request can be sent again") | rolled back; the identity provider is not called |
| COMMIT itself | the generic `500 internal_error` | unknown; `GET /v1/me/deletion` tells |

**Step 2, delete the identity account**, only after step 1 committed, and only while no earlier attempt
was confirmed: the `BeforeIdentityDeletion` test seam, then `IdentityDeleter.DeleteIdentity`. A "user not
found" answer counts as deleted. Every attempt is recorded: `identity_attempts + 1`, `identity_deleted_at`
on the first confirmation (never cleared), `identity_last_failure_at` on a failure. Concurrent attempts
serialize on the row, so the record is deleted as soon as any attempt confirmed it. The step runs
detached from the request's cancellation, bounded at 30 s.

| Outcome | Answer |
|---|---|
| confirmed (now or earlier) | `200`, `status: completed` |
| failed | `202`, `status: identity_deletion_pending`: the server data is erased, the identity account is not deleted yet. The provider's message is never returned, and the log gets its class only. |
| recording failed | `500`; the record stays pending (§13.5) |

**Deletion document** (`POST` answers and `GET`):

```json
{"deletion_id":"uuid","account_id":"uuid","status":"completed | identity_deletion_pending",
 "requested_at":"RFC 3339","completed_at":"RFC 3339, only when completed",
 "server_data":{"status":"erased","erased_at":"RFC 3339","profiles":0,"device_links":0,"events":0,"imports":0},
 "identity_provider":{"status":"deleted | pending","attempts":1,"deleted_at":"RFC 3339, only when deleted"},
 "not_deleted":[{"what":"deletion_record","why":"…"},{"what":"device_data","why":"…"}]}
```

`server_data.erased_at` equals `requested_at`: the erasure and its record are one transaction. A retry
(a lost answer, a double tap, a later return) and a concurrent `POST` answer the same deletion: the same
`deletion_id`, `requested_at` and erased counts.

### 13.4 Nothing comes back
- **The gate** (§2): every authenticated request of a deleted account gets the one fixed
  `410 account_deleted`, except `GET` and `POST /v1/me/deletion`. That covers an old token, a new
  sign-in of the same identity while its deletion is pending, and a replayed frozen import or upload.
- **Writes racing the erasure** re-check the deletion inside their own transaction. `Store.Import`
  checks right after its advisory lock. Every lookup that finds no profile (`OwnsProfile`, `Profile`,
  `Ingest`, `UpdateSettings`, the pull and progress snapshot, the export snapshot, and an empty
  `GET /v1/me` list) answers `410` when the deletion is recorded, never `404`. An ingest or import already
  in its transaction commits first, and the erasure then removes it with the rest.
- **Once the identity account is deleted**, its tokens no longer verify (the emulator user lookup
  fails; in local-supabase mode Auth's `GET /user` refuses them), so they get the uniform `401`. For
  local-supabase mode the real-GoTrue deletion test exercises this (§14).

### 13.5 What stays, and known limits
- **Not full erasure of identity metadata.** The `accounts` row (`account_id`, `auth_mode`, `issuer`,
  `subject`, `created_at`) and the `account_deletions` row (`deletion_id`, `requested_at`, the erased
  counts, `identity_attempts`, `identity_deleted_at`, `identity_last_failure_at`) stay. No learning
  data, settings, consent, device identifiers or payloads remain. `not_deleted` names this record.
- **Retention is not decided.** No retention period, purge or default is approved, and no deletion
  contact is named; both rows stay until an operator purge that does not exist yet. These are human
  decisions, held until before any real user. The technical floor: purging before the identity deletion
  is confirmed, plus the longest token lifetime, would let a token still in circulation re-create the
  account. Today's scope is synthetic fixtures only.
- **Backups:** the local service keeps none. A deployment that adds backups must add a `backups` entry
  to `not_deleted` in the same change; nothing claims every copy is gone.
- **Limits:** no background retry of a pending identity step (the user retries, or an operator acts; the
  runbook is pending). If recording fails after the provider deleted the identity, a stale pending
  record is left for operator reconciliation. An account over the export limit has no self-service
  export.

## 14. Local synthetic Supabase mode (`AYA_MODE=local-supabase`)
For synthetic local fixtures only: the API and its database on literal loopback, and one explicitly
configured Supabase Auth (GoTrue v2.197.0) on literal loopback. Production stays refused.

- **Settings** (§12). The Auth URL may use plain `http`, which is accepted only on literal loopback. The
  issuer is matched exactly and need not match the URL. The admin credential file must be an absolute
  path whose final component is a regular file, not a symlink, owned by the service's user and closed to
  group and others (mode `0600` or `0400`). It holds at most 8 KiB: one credential of visible ASCII,
  optionally followed by a single newline. It is read once at startup, kept as a redacted secret, and
  sent only on the admin API's deletion request. Every refusal names the variable, never its value or
  the path.
- **Startup.** `server.New` builds `authn.SupabaseVerifier` with the key set fetched from Auth
  (`FetchJWKS`) and must fetch it once (`RefreshKeys`) before it opens the store (§1).
- **Tokens.** These rules are unchanged from the verifier:
  - go-jose verifies each token's asymmetric signature (fixed allowlist), and the trusted key must match
    both kid and algorithm;
  - issuer, audience, the `authenticated` role, a non-anonymous canonical UUID subject, a session and
    valid times are all checked;
  - Auth's `GET /user` is then asked once, with the token itself, and must confirm the user and session.

  The key set is cached for at most 10 minutes. A token from an unknown key triggers a refresh, at most
  one every 30 seconds, and concurrent tokens share it. It is fetched only from `{AYA_SUPABASE_URL}/.well-known/jwks.json`,
  with no credential or cookie and no redirects. Every failure is the uniform `401`.
- **Accounts** record `auth_mode` `local-supabase` and are keyed by (configured issuer, token subject).
  Nothing moves or matches emulator accounts (§9).
- **Tests.**
  - `local_supabase_test.go` covers:
    - the config guards and the startup gating against an owned stand-in;
    - a real password session of the pinned GoTrue fixture reaching `GET /v1/me`;
    - the uniform `401` for tokens signed with Auth's own key but naming another issuer, another audience or
      `service_role`.
  - `real_security_flows_test.go` runs against the same fixture, with owned users that Auth's admin API creates
    and deletes. It covers:
    - a refresh keeping the user, session and password sign-in time;
    - local and global logout, and bans;
    - the recent sign-in rule, with a refresh never renewing it and a new password sign-in restoring it;
    - the export's exact content;
    - a deletion whose identity step fails with a wrong admin credential, then completes after a restart with
      the right one.
  - For the recent sign-in test, the service clock is set through `server.Options.Now` (the handler's
    recent-sign-in check and, in this mode, the Supabase verifier). Nil is the real clock, and no window
    changes.
- **Not covered:** a provider deletion whose success answer is lost, which is left to operator
  reconciliation. The Auth container's own hardening belongs to its fixture, not to this service.
  This mode needs no Firebase code: only a `firebase_emulator` build includes the Firebase Admin SDK
  (§12.1).

## 15. Deploy modes (`AYA_MODE=deploy-smoke`, `AYA_MODE=local-compose`)
For containers only, and neither is production: `production` stays refused even with every deploy
setting present. Both run in a default build.

- **`deploy-smoke`** verifies a deployment's containers, TLS, readiness and database isolation. It trusts
  no identity provider: every token, well-formed or not, gets the uniform `401`, so no account is created.
- **`local-compose`** is the local synthetic Compose stack (`deploy/README.md`). The API trusts the
  stack's own standalone GoTrue v2.197.0 at its name on the stack's internal network, with the §14 token
  rules. Its accounts record `auth_mode` `local-supabase`, the provider kind, so the schema stays at
  version 3 and needs no new migration.

**Settings.** Every one is explicit: there is no default listen address, Host or database.

| Variable | Value |
|---|---|
| `AYA_LISTEN` | required; `0.0.0.0:<port>` or a literal IPv4 loopback `host:port`, with an explicit non-zero port |
| `AYA_ALLOWED_HOSTS` | required; the exact Host values answered: lowercase names or IP literals (IPv6 in brackets), each with an optional port, comma-separated without spaces, each once. The container's own probe, `127.0.0.1:<listen port>`, is added; `localhost:<port>` is not |
| `AYA_CORS_ORIGINS` | optional; the exact `https` origins granted (a lowercase host and an optional port other than 443, nothing else). Unset or empty means native clients only; `http://localhost:8087` is never granted |
| `AYA_DB_HOSTS` | required; the exact database hosts, without ports: names, IP literals (IPv6 without brackets, as pgx parses them) or socket directories |
| `AYA_DATABASE_URL_FILE` | required; the absolute path of a private file (the service user's own regular file, not a symlink, mode `0600` or `0400`) holding one `postgres://` URL, optionally followed by one newline |
| `AYA_DB_SCHEMA`, `AYA_EXPORT_MAX_BYTES` | as in §12 |
| `AYA_SUPABASE_URL` | local-compose; `http` or `https` to exactly one entry of `AYA_AUTH_HOSTS`, port included, with no userinfo, query or fragment; a path is allowed |
| `AYA_AUTH_HOSTS` | local-compose; the exact `name:port` values of Auth on the stack's internal network |
| `AYA_SUPABASE_ISSUER`, `AYA_SUPABASE_AUDIENCE`, `AYA_SUPABASE_ADMIN_KEY_FILE` | local-compose; as in §12 and §14 |

Refused, naming the variable and quoting no value:
- `AYA_DATABASE_URL` set, even empty (`config.ErrSecretInEnvironment`);
- `FIREBASE_AUTH_EMULATOR_HOST` and `GOOGLE_APPLICATION_CREDENTIALS`, even empty;
- a setting of another mode (`config.ErrSettingNotUsed`): the Firebase project, and in deploy-smoke any
  Supabase setting.

**Database hosts are checked twice.** First in the URL string: every authority host and every `host`
parameter must be listed, and a URL that names no host is refused (`config.ErrDatabaseHostNotAllowed`).
Then in what pgx parsed (`store.ParseConfigAllowing`): the primary and every fallback, after PG*
variables and service files (`store.ErrDatabaseHostNotAllowed`). Neither loopback nor a Unix socket is
implied.

**Startup verifies the schema and never migrates it.** `store.VerifySchema` reads, in one read-only
transaction, whether the schema records exactly this binary's migrations. An absent, older or newer
schema refuses startup with `store.ErrSchemaNotCurrent`, and is left as it was. The runtime role
therefore needs no DDL right: only the migration job changes the schema.

**Requests.** The §2 rules apply, with three differences:
- the Host and CORS lists above replace the loopback ones;
- every answer also carries `Strict-Transport-Security: max-age=86400`;
- public `GET /v1/readyz` answers `200 {"status":"ready"}` while the database answers and the schema is
  current, and `503 {"status":"not_ready"}`, with no detail, otherwise. It runs the same read-only check,
  bounded at 3 s. `GET /v1/healthz` stays liveness only.

**Supabase verifier.** `SupabaseConfig.InternalHosts` lets the verifier use plain `http` to an exactly
listed lowercase `name:port`, and only together with `LocalSynthetic`. Its requests are otherwise
unchanged: bounded, through no proxy of the environment, with no cookie and no redirect.

**Migration job:** `backend/cmd/ayailmu-migrate`.
- **Settings:** `AYA_DATABASE_URL_FILE` (the schema owner's URL), `AYA_DB_HOSTS` and `AYA_DB_SCHEMA`,
  under the same guards (`config.LoadMigration`).
- **Run:** it applies `store.Migrate` as the owner, verifies the result, and prints only the version on
  stdout (`3` today), then exits 0. Running it again changes nothing.
- **Refusal:** it exits 1, with a reason on stderr that names the setting. It prints nothing on stdout,
  quotes no URL or password, and creates nothing.

**Probe:** `ayailmu-api probe <url>`, the runtime image's healthcheck (the image has no shell or curl).
- It makes one GET, bounded at 5 s, of a plain-`http` URL on a literal loopback IP with an explicit port.
- It follows no redirect, uses no proxy, keeps no connection and never prints the URL.
- **Exit 0:** a `200` answer.
- **Exit 1:** any other answer, a redirect, a refused connection or no answer in time.
- **Exit 2:** a refused URL (a name, even `localhost`, another address, `https`, userinfo, a query or
  fragment, no port) or a malformed command line, without connecting anywhere.
- `ayailmu-api` with any other argument also exits 2.
