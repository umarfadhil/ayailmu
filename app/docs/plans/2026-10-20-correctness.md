# Correctness slice, 2026-10-20: C1 report wording, C2 API deadline, C3 build provenance

Authorized 2026-10-20: three correctness fixes; no UI redesign, no new services, no new dependencies. RN worktree branch
`feature/rn-correctness-20261020` (from `ee009b4`). Backend worktree branch `feature/api-build-provenance-20261020` (from
`37758c1`). Infra (PR4 `d192472`), deploy helpers, Go schemas, dependencies and the pre-existing untracked
`deploy/tools/__pycache__/` are not touched.

## Status

- **C2 RED:** observed by Codex and SHA-frozen. The transport suite had 7 failures and 2 passing guards; the controller suite failed 3 tests at exactly the planned assertions. All 788 earlier test IDs passed, and typecheck and lint were at 0.
- **C1 and C2 GREEN:** observed by Codex at 08:15:50 UTC.
  - 800 of 800 tests passed in 52 suites, with 0 failures, skips or runtime errors.
  - All 788 baseline IDs pass, and typecheck and lint are at 0.
  - The C2 frozen tests and every earlier helper are unchanged.
  - Receipt: `phase29-c2-c1-green1-verification.json`.
  - Codex source-reviewed the implementation: settle before abort, caller signal identity kept, journal and controller unchanged.
- **C3 RED:** observed by Codex at 08:27 UTC, then frozen (2 Go test files and 1 RN test file).
  - **RN:** 800 tests passed. The 7 C3 tests failed with ordinary failures, all at the missing `build-provenance` element. Typecheck and lint were at 0, and every C2 frozen test still passed.
  - **Backend startup test:** it failed at an ordinary assertion: 0 build lines before the configuration refusal.
  - **Helper package:** its compile failed with `undefined: Build`, as expected. That is a build failure, not 29 failing subtests.
  - **Formatting:** the new Go test files are gofmt-clean.
  - **Note:** Codex's first startup QA attempt lacked the correct `GOMODCACHE` and did not run. Run offline against the existing module cache, it reached the expected ordinary RED at once, with no source or credential change.
- **C3 GREEN:** observed by Codex at 08:33 UTC.
  - **RN:** 807 of 807 tests in 53 suites, with 0 failures, pending tests or runtime errors. All 788 earlier test IDs and all 12 C2 cases pass, and typecheck and lint are at 0.
  - **Unchanged files:** all 64 protected RN files and 39 backend files are unchanged, and the reviewed C1/C2 source is unchanged.
  - **Go:** default 62 top-level tests / 786 subtests and `firebase_emulator` 90 / 966 pass, in both normal and race runs. `go vet` reports 0 in both profiles. There are 0 failures, skips or missing original tests.
  - **C3 tests:** the startup test's ordinary RED is now GREEN, and the pure helper's 29 subtests now run and pass.
  - **Source checks:** gofmt and diff checks are clean.
  - **Scope of this evidence:** these are source and test checks only, not a deployment, CI, hosted, native, browser or stamped-build proof. Codex's next step is a stamped build with browser checks, then Git publication; neither has been done yet. No claim is made about production users, errors or telemetry.

## Not in this slice: real readiness limits

These are not fixed or claimed by this slice. The app is not production-ready on these points, and nothing is deployed.

- **Sign-in sessions live in memory only.** Password sign-ins use SDK clients with `persistSession: false`. Google SDK clients run with `persistSession: true`, but over a per-client RAM storage adapter: a `Map` that is emptied and disposed when the client is retired or let go. No access or refresh token is written to durable storage, and every app start needs a new sign-in. A pending Google attempt keeps only its flow id and PKCE verifier (no token) in the platform's short-lived, single-use attempt store.
- **Sign-in is limited to prepared accounts.** It uses prepared synthetic `.test` identities only. Sign-up is off, and there is no SMTP or email delivery.
- **Google sign-in has no sensitive-action step-up.** The API's step-up (`reauthentication_required`) asks for a recent password sign-in, which a Google session cannot give.
- **No platform proof.** There is no native build or store proof, no public hosting proof, and no deployment.
- **Opt-in profiles.** Continue with Google and the staging profile are build opt-ins.
- **Manual sync.** Sync runs only when asked («Sinkronkan sekarang», or creating or linking a profile). There is no background sync or retry scheduler.
- **No feedback intake.** Nothing on the server takes in item reports or other learner feedback.
- **Synthetic Auth fixture (Codex's work, done and not repeated).** The admin JWT had expired at 2026-10-20T00:44:56Z. With express authorization, Codex renewed it:
  - four 12 h JWTs under the same existing key and claims, issued 08:00:13Z and valid until 20:00:13Z;
  - only `fixture.env` and the admin key changed;
  - the full Go baseline passes: default 60 top-level tests / 757 subtests and legacy 88 / 937, with 0 failures and 0 skips.

  This slice does no credential action, no GitHub Mobile login retry, and makes no real Google change.

## C1: the report sheet says what happens (saved on this device only)

**Status:** GREEN, observed by Codex.

`src/app/session.tsx` only ever calls `store.addReport` on the dataset in use; nothing uploads reports. The wording in
`ReportButton` (`src/ui/components.tsx`) now says so:

- the save button reads «Simpan laporan»;
- after saving, the link reads «Laporan tersimpan di perangkat ini» (its accessibility label adds «Laporkan soal lagi»);
- a sentence in the sheet reads «Laporan hanya disimpan di perangkat ini dan tidak dikirim ke mana pun.»

These are unchanged: testIDs, the error message, `ReportRecord`, storage and consent versions, and the developer JSON
export. There is no network call.

## C2: every account API request settles within one deadline

**Status:** GREEN, observed by Codex.

**What changed.** `src/api/client.ts`, plus `authorized()` in `src/auth/supabaseAuth.ts` and `src/auth/emulatorAuth.ts`.
The journal and `AccountContext` are unchanged.

- **Deadline:** `API_REQUEST_TIMEOUT_MS = 60_000`, one deadline per request covering the headers and the body together. It is never restarted, and a missed deadline gives `ApiError(0, 'network')`, so the existing messages apply.
- **Caller signal:** it reaches `fetch` as the same object (frozen `accountApi.test.ts:107`), and the client only listens to it.
- **Caller abort:** an abort before or during the request gives `ApiError(0, 'aborted')` at once, even if `fetch` ignores it. An already-aborted signal sends nothing.
- **No caller signal:** the client uses its own controller and aborts it after settling at the deadline.
- **Settles once:** the timer and listener are released on every path. Late replies are never read, and late rejections are handled.
- **No new size cap:** request bytes go out unchanged.
- **`authorized()`:** it aborts its own controller once its call settles. The session lets go of the call first, and `settled` guards re-entry.

**Verified by the frozen suites under GREEN** (fake clock):
- one 60 s deadline across headers and body;
- caller and owned signals behave as described;
- late replies are ignored;
- a 16 MiB body succeeds byte for byte;
- busy clears at 60 s after a single stalled request;
- busy clears at 120 s, two deadlines in a row, for a linked profile's stalled pull and then progress read;
- the import is retried byte for byte and replayed, with no duplicate profile.

The post-settle abort in `authorized()` was source-reviewed by Codex; no dedicated test asserts it.

**Remaining limitations:**
- Physical cancellation depends on `fetch` honouring `AbortSignal`.
- The server may commit a request the client gave up on, which the byte-identical retry makes safe.
- A full 16 MiB import needs about 2.3 Mbit/s sustained within 60 s; completion over an arbitrarily slow network is never guaranteed.

## C3: truthful build provenance

**Status:** GREEN, observed by Codex at 08:33 UTC (see Status). The "Expected coverage" counts below were written before that run, and the run matches them. The values the test binary actually printed in its startup line were not reported. This is a source and test check only, not a stamped build or browser check.

### RN bundle (developer page): `src/app/dev.tsx`

**Inputs.**
- `EXPO_PUBLIC_BUILD_REVISION` and `EXPO_PUBLIC_BUILD_DIRTY`, which the builder (Codex) passes to `expo export`.
- `package.json`, `app.json` and the build config are unchanged.

**What GREEN does.**
- **`reportedBuild()`** reads both values with static accesses (`process.env.EXPO_PUBLIC_BUILD_REVISION`, `process.env.EXPO_PUBLIC_BUILD_DIRTY`), so Expo can inline them. It reads them when the page renders.
- **The revision** is shown only if it matches exactly `/^[0-9a-f]{7,40}$/`.
- **The dirty flag** is used only if it is exactly `"true"` or `"false"`.
- **Anything else** becomes «tidak diketahui» or «status perubahan tidak diketahui». Nothing is trimmed or shortened, and no raw value (path, host, user or secret) is ever rendered.
- **The provenance line** is `<P testID="build-provenance">`, with exactly:
  - `Revisi bundel (dilaporkan saat build): <revision | tidak diketahui>; <status>.`
  - where `<status>` is `tanpa perubahan yang belum di-commit`, `ada perubahan yang belum di-commit` or `status perubahan tidak diketahui`.
- **`fromDevelopmentServer()`** reads Metro's `__DEV__` global through `globalThis` when the page renders. React Native's bundled types do not declare `__DEV__`, and this access compiles without them. When it is true, the page adds `<P testID="build-provenance-dev">`: «Bundel dari server pengembangan: kodenya bisa sudah berubah sejak server dimulai.»
- **No other claims:** the page says nothing about HEAD, the runtime, the native app or the API version.
- **Unchanged:** the page's other lines, the account-scope wording, the answer log, the JSON export, and the reset guards.

**Expected coverage:** all 7 tests of the frozen `src/__tests__/dev-build-provenance.test.tsx` pass, which should give 807 of 807 tests in 53 suites. The `__DEV__`-false test checks that the development-server note is absent.

### Backend API (`ayailmu.local/backend`)

**New `backend/internal/provenance/provenance.go`**, standard library only:
- `type Build struct { Revision, Dirty string }` and `func FromBuildInfo(info *debug.BuildInfo, ok bool) Build`.
- `!ok` or nil info gives `unknown` for both fields.
- Only `vcs.revision` and `vcs.modified` are read. A key that appears more than once makes its field `unknown`.
- The revision must match exactly `^[0-9a-f]{7,40}$`, and the modified flag must be exactly `true` or `false`. The two fields are independent.
- Nothing raw is passed on: not the whole `BuildInfo`, not paths, not environment values.
- The unexported helpers `single`, `revisionPattern` and `unknown` do not clash with the frozen test's names.

**`backend/cmd/ayailmu-api/main.go`:**
- In `run()`, right after the logger is set and before `server.New`, it logs one line:
  ```go
  stamp := provenance.FromBuildInfo(debug.ReadBuildInfo())
  logger.Info("ayailmu-api: build", "revision", stamp.Revision, "dirty", stamp.Dirty)
  ```
  This is one line, logged before both a configuration refusal and serving.
- `main()`'s `probe` dispatch is unchanged: the healthcheck prints no new line.
- Nothing changes in the health body, endpoints, auth, store, schema, dependencies, deploy tools or ldflags.
- The package comment notes the startup line.

**Expected coverage:**
- `TestFromBuildInfo` passes all 29 subtests.
- `TestRunLogsSanitizedBuildProvenanceBeforeRefusing` passes. In a test binary the line should read `revision=unknown dirty=unknown`, because `go test` stamps no VCS data.
- If each run covers both new packages, the Go totals should become default 62 top-level tests / 786 subtests and legacy 90 / 966, with the earlier tests unchanged.

**Limitations (documented, not hidden):**
- The startup line states what the Go toolchain stamped, not a verified HEAD, and `dirty` reflects the working tree at build time.
- `go run`, `go test`, `-buildvcs=false` and a build context without `.git` all give `unknown`.
- 64-hex SHA-256 object names fall outside the 7–40 rule and show as `unknown`.
- RN values are only as truthful as the builder's environment at export. A development-server bundle may differ from the reported revision, and the page says so.

## Open points

1. **Physical cancellation.** Implemented in C2 (`authorized()`) and source-reviewed. No dedicated test asserts the post-settle abort.
2. **Stale developer-page wording.** The account-scope text («… (emulator pengembangan)») is unchanged. It is outside C1–C3 as authorized and is not expanded here.
