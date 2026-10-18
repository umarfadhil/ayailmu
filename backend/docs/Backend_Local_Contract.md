# AyaIlmu local backend: HTTP contract (v1)

Local-only and synthetic. The service runs in emulator mode against the loopback Firebase Auth emulator
(demo project) and a loopback or Unix-socket PostgreSQL. It serves synthetic adult profiles only.
`backend/internal/server/*_test.go` is the executable form of this document; where they differ, the
tests win and this file is corrected.

**Status:** implemented, local only. That covers the configuration, verifier and store guards; the
schema migration; every §3 route (health, account, curriculum metadata, profile read and patch, guest
import, event upload, pull and progress) behind the §2 guards; the client journal (§10); and the
`backend/cmd/ayailmu-api` command (§12).

## 1. Startup (fails closed)
`server.New` applies, in order:
1. the `config` guards (production refused; loopback listen; `demo-` project; emulator host; no
   `GOOGLE_APPLICATION_CREDENTIALS`; database hosts named in the string);
2. the verifier guards (the process `FIREBASE_AUTH_EMULATOR_HOST` must equal the configured emulator);
3. the store guard: `store.ParseConfig` lets pgx parse the URL (including PG* variables and service
   files), then refuses unless the primary host **and every fallback** is a literal loopback IP or a
   Unix socket directory (`ErrDatabaseNotLocal`). Nothing is opened before this passes.

Then it migrates the schema (`AYA_DB_SCHEMA`, default `ayailmu`). No socket is bound until
`ListenAndServe`.

## 2. Rules for every request
Checks run in this order: Host, the CORS gate, authentication, route, method, media type, size, JSON,
then the route's own checks.

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
  <Firebase ID token>` header, verified by the emulator verifier. Anonymous sign-ins are refused.
  - Any failure → `401 unauthenticated` with `WWW-Authenticate: Bearer realm="ayailmu"`.
  - The 401 header and body are byte-identical whatever the cause.
- **Accounts:** the first authenticated request creates the account, keyed by `(issuer, subject)`. No
  email, name, phone or photo is stored.
- **Responses:** every response sends `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  - Success bodies are `application/json`.
  - Errors are `application/problem+json` (RFC 9457): `{"type","title","status","code","detail"}`,
    where `code` is stable and `type` is `urn:ayailmu:problem:<code>`. Problems never echo request
    content.
- **Routes and methods:** an unknown route → `404 not_found`. A known route with the wrong method →
  `405 method_not_allowed`, with `Allow` listing the methods in sorted order, comma-separated.
- **Media types:** `POST` bodies need `application/json`; `PATCH` needs
  `application/merge-patch+json`. Otherwise → `415 unsupported_media_type`.
- **Body limits:** events batch 4 MiB; import 16 MiB; profile patch 16 KiB → `413 body_too_large`.
- **Malformed bodies:** malformed JSON → `400 invalid_json`. Valid JSON in the wrong shape (unknown or
  missing members, wrong types) → `400 invalid_request`.
- **Profile IDs:** another account's profile, a random UUID and a malformed ID all get the same
  `404 not_found` body.

## 3. Routes

| Method and path | Result |
|---|---|
| `GET /v1/healthz` | `200 {"status":"ok","mode":"emulator"}`, no token |
| `GET /v1/me` | `200 {"account_id","profiles":[{"profile_id","revision","high_seq"}]}` |
| `GET /v1/curricula` | `200 {"families":[…],"packs":[…]}`: the curriculum registry exactly, metadata only |
| `POST /v1/imports` | guest import or link; the only way a profile is created (§5) |
| `GET /v1/profiles/{pid}` | `200` profile document, `ETag: "r<revision>"` |
| `PATCH /v1/profiles/{pid}` | conditional merge patch of `settings` (§4) |
| `POST /v1/profiles/{pid}/events` | batch ingest (§6) |
| `GET /v1/profiles/{pid}/events` | pull by cursor (§7) |
| `GET /v1/profiles/{pid}/progress?family=` | factual counts (§8) |

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
- **Tables:** `accounts`, `profiles`, `profile_sources`, `events` and `imports`
  (`backend/internal/store/migrations`). Payloads are stored as `text` (exact bytes, never `jsonb`).
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
- Production authentication or mode (refused at startup).
- Session snapshots (no route, never merged).
- `screen_view` and `item_report` events (`422 unsupported_kind`).
- Support purchases and mock-store routes (404).
- Child profiles.
- Deletion or export routes.
- Server-side mastery, readiness or retention.
- Any cloud, real email, payment or deployment.

## 12. Running locally
`backend/cmd/ayailmu-api` runs the service. It reads its settings from the environment, applies every
guard, migrates the schema and serves on the loopback address until interrupted (SIGINT or SIGTERM).

| Variable | Value |
|---|---|
| `AYA_MODE` | `emulator`; `production` is refused |
| `AYA_LISTEN` | optional; a literal loopback `host:port`, default `127.0.0.1:8091` |
| `AYA_DATABASE_URL` | a loopback or Unix-socket PostgreSQL URL, supplied privately; never committed or logged |
| `AYA_DB_SCHEMA` | optional; default `ayailmu` |
| `AYA_FIREBASE_PROJECT_ID` | a `demo-` project, such as `demo-ayailmu` |
| `FIREBASE_AUTH_EMULATOR_HOST` | the local Auth emulator, such as `127.0.0.1:9099` |

`GOOGLE_APPLICATION_CREDENTIALS` must be unset. With these variables set privately, run
`go run ./cmd/ayailmu-api` from `backend/`. The log names a refused setting, a listen failure's system
error or an error class; it never prints the database URL, a token or request content.
