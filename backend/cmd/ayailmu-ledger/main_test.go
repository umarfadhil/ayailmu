package main

// Deletion-ledger operator tool, Phase 9 RED. export writes the database's ledger into a new private file, reading only.
// replay reads a private ledger file, replays it into the database, and only then deletes each entry's exact identity
// through the real Supabase admin path, even when the ledger records that deletion as confirmed. A refusal exits 1 and
// writes nothing, asking Auth nothing; an identity deletion that is not confirmed (failed, refused or its answer lost)
// exits 3 with the replay committed and the tombstones protective, and a later replay that Auth confirms, a precise
// user_not_found included, exits 0. Every output is sanitized. The tests use the isolated loopback PostgreSQL
// (AYA_TEST_DATABASE_URL) in fresh aya_t_ schemas that they drop, a loopback stand-in for the stack's Auth, and the
// pinned real GoTrue fixture (AYA_REAL_AUTH_FIXTURE) with users they create and remove themselves; missing
// infrastructure fails them, nothing is skipped. No token, password, credential or connection string is printed.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/store"
)

const (
	// toolIssuer is the stack's fixed synthetic issuer, which the loopback stand-in of Auth answers for.
	toolIssuer = "https://auth.ayailmu-local.test/auth/v1"
	// toolAdminKey is a synthetic marker, not a credential: the stand-in checks it arrives, and no output may quote it.
	toolAdminKey = "fake-ledger-admin-key-not-real-6627"
)

// toolBase is the synthetic time of every fixture: each account's creation, and the ledger's times after it.
var toolBase = time.Date(2026, 10, 15, 8, 0, 0, 0, time.UTC)

func lookupIn(env map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := env[k]
		return v, ok
	}
}

// testDatabaseURL returns the isolated loopback PostgreSQL. It fails, never skips, when it is missing.
func testDatabaseURL(t *testing.T) string {
	t.Helper()
	dbURL := os.Getenv("AYA_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("AYA_TEST_DATABASE_URL is not set: this test needs the isolated loopback PostgreSQL; refusing to skip")
	}
	return dbURL
}

func randomHex(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}

// newUUID is a fresh synthetic canonical UUID: lowercase, version 4.
func newUUID(t *testing.T) string {
	t.Helper()
	h := randomHex(t, 16)
	return h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-a" + h[17:20] + "-" + h[20:]
}

// privateFile writes content to a new file of exactly mode in a test-owned directory and returns its absolute path.
func privateFile(t *testing.T, name, content string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
}

// toolDB is a migrated fresh schema of the isolated PostgreSQL, with a direct pool for the test's own rows and reads;
// its cleanup drops that test-owned schema and nothing else.
type toolDB struct {
	pool     *pgxpool.Pool
	schema   string
	dbURL    string
	host     string
	password string
}

func openToolDB(t *testing.T) *toolDB {
	t.Helper()
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	u, err := url.Parse(dbURL)
	if err != nil || u.Hostname() == "" {
		t.Fatal("AYA_TEST_DATABASE_URL must be a postgres:// URL that names its host")
	}
	password, _ := u.User.Password()
	schema := "aya_t_" + randomHex(t, 6)
	cfg, err := store.ParseConfig(dbURL, schema)
	if err != nil {
		t.Fatalf("fixture database config: %v", err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("fixture database pool: %v", err)
	}
	t.Cleanup(func() {
		defer pool.Close()
		if !strings.HasPrefix(schema, "aya_t_") {
			t.Error("refusing to drop a schema this test does not own")
			return
		}
		if _, err := pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
			t.Errorf("drop the test schema: %v", err)
		}
	})
	st, err := store.Open(ctx, dbURL, schema)
	if err != nil {
		t.Fatal("open the fixture store")
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatal("migrate the test schema")
	}
	return &toolDB{pool: pool, schema: schema, dbURL: dbURL, host: u.Hostname(), password: password}
}

func (db *toolDB) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := db.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("fixture statement: %v", err)
	}
}

// account inserts a local-supabase account row of issuer, created at toolBase.
func (db *toolDB) account(t *testing.T, accountID, issuer, subject string) {
	t.Helper()
	db.exec(t, `INSERT INTO accounts (account_id, auth_mode, issuer, subject, created_at) VALUES ($1::uuid, 'local-supabase', $2, $3, $4)`,
		accountID, issuer, subject, toolBase)
}

// seedOwned gives the account one profile with one device link, one import and two events: (1, 1, 2, 1) rows.
func (db *toolDB) seedOwned(t *testing.T, accountID, tag string) {
	t.Helper()
	profileID := newUUID(t)
	db.exec(t, `INSERT INTO profiles (profile_id, account_id, kind, consent_version, consent_at)
		VALUES ($1::uuid, $2::uuid, 'adult', 'trial-consent-1', $3)`, profileID, accountID, toolBase)
	db.exec(t, `INSERT INTO profile_sources (account_id, profile_id, app, install_id, local_profile_id)
		VALUES ($1::uuid, $2::uuid, 'expo', $3, $4)`, accountID, profileID, "inst-"+tag, "lrn-"+tag)
	db.exec(t, `INSERT INTO imports (account_id, import_id, request_sha256, profile_id, receipt)
		VALUES ($1::uuid, $2, decode(repeat('ab', 32), 'hex'), $3::uuid, '{}')`, accountID, "imp-"+tag, profileID)
	for seq := 1; seq <= 2; seq++ {
		db.exec(t, `INSERT INTO events (profile_id, seq, event_id, kind, record_schema, schema_version, family, track,
			content_version, rules_version, curriculum_status, occurred_at, local_date, payload_raw, semantic_sha256, source_app,
			source_install_id, source_app_version, source_local_profile_id, import_id)
			VALUES ($1::uuid, $2, $3, 'answer', 'aya.answer', 1, 'arab', 'core', 'c1', 'r1', 'registered', $4, '2026-10-15', '{}',
			decode(repeat('cd', 32), 'hex'), 'expo', $5, '1.0.0', $6, $7)`,
			profileID, seq, fmt.Sprintf("ans-%s-%d", tag, seq), toolBase, "inst-"+tag, "lrn-"+tag, "imp-"+tag)
	}
}

// ownedRows counts the account's profiles, device links, events and imports.
func (db *toolDB) ownedRows(t *testing.T, accountID string) [4]int64 {
	t.Helper()
	var n [4]int64
	if err := db.pool.QueryRow(context.Background(), `SELECT
		(SELECT count(*) FROM profiles WHERE account_id = $1::uuid),
		(SELECT count(*) FROM profile_sources WHERE account_id = $1::uuid),
		(SELECT count(*) FROM events WHERE profile_id IN (SELECT profile_id FROM profiles WHERE account_id = $1::uuid)),
		(SELECT count(*) FROM imports WHERE account_id = $1::uuid)`, accountID).Scan(&n[0], &n[1], &n[2], &n[3]); err != nil {
		t.Fatalf("count the account's rows: %v", err)
	}
	return n
}

// identityRecord is the identity step of the account's tombstone; found is false when it has none.
type identityRecord struct {
	found         bool
	deletionID    string
	attempts      int
	deletedAt     *time.Time
	lastFailureAt *time.Time
}

func (db *toolDB) identity(t *testing.T, accountID string) identityRecord {
	t.Helper()
	r := identityRecord{found: true}
	err := db.pool.QueryRow(context.Background(), `SELECT deletion_id::text, identity_attempts, identity_deleted_at, identity_last_failure_at
		FROM account_deletions WHERE account_id = $1::uuid`, accountID).Scan(&r.deletionID, &r.attempts, &r.deletedAt, &r.lastFailureAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return identityRecord{}
	case err != nil:
		t.Fatalf("read the tombstone: %v", err)
	}
	return r
}

// digest fingerprints every app table row by row; equal digests mean nothing was written.
func (db *toolDB) digest(t *testing.T) string {
	t.Helper()
	var all []string
	for _, table := range []string{"accounts", "account_deletions", "profiles", "profile_sources", "events", "imports"} {
		var d string
		if err := db.pool.QueryRow(context.Background(), `SELECT count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '')
			FROM `+table+` AS x`).Scan(&d); err != nil {
			t.Fatalf("digest %s: %v", table, err)
		}
		all = append(all, table+"="+d)
	}
	return strings.Join(all, ";")
}

// toolEntry is one deletion as a ledger document carries it, erased (1, 1, 2, 1) at toolBase plus an hour.
type toolEntry struct {
	accountID, subject, deletionID string
	attempts                       int
	deletedAt, lastFailureAt       *time.Time
}

func jsonTime(t *time.Time) string {
	if t == nil {
		return "null"
	}
	return `"` + t.UTC().Format(time.RFC3339Nano) + `"`
}

// ledgerDocument is the documented ledger document (store.EncodeDeletionLedger) of issuer's local-supabase accounts,
// written out by hand.
func ledgerDocument(issuer string, entries ...toolEntry) string {
	parts := make([]string, len(entries))
	for i, e := range entries {
		parts[i] = fmt.Sprintf(`{"account_id":%q,"auth_mode":"local-supabase","issuer":%q,"subject":%q,"account_created_at":"2026-10-15T08:00:00Z",`+
			`"deletion_id":%q,"requested_at":"2026-10-15T09:00:00Z","erased":{"profiles":1,"device_links":1,"events":2,"imports":1},`+
			`"identity":{"attempts":%d,"deleted_at":%s,"last_failure_at":%s}}`,
			e.accountID, issuer, e.subject, e.deletionID, e.attempts, jsonTime(e.deletedAt), jsonTime(e.lastFailureAt))
	}
	return fmt.Sprintf(`{"format":"ayailmu-deletion-ledger-1","exported_at":"2026-10-16T08:00:00Z","auth_mode":"local-supabase","issuer":%q,"deletions":[%s]}`,
		issuer, strings.Join(parts, ","))
}

// at is toolBase plus d.
func at(d time.Duration) *time.Time {
	v := toolBase.Add(d)
	return &v
}

// databaseEnv is the tool's database settings for db: the URL in a private file, its host, the test schema.
func databaseEnv(t *testing.T, db *toolDB) map[string]string {
	t.Helper()
	return map[string]string{
		config.EnvDatabaseURLFile: privateFile(t, "database-url", db.dbURL+"\n", 0o600),
		config.EnvDBHosts:         db.host,
		config.EnvSchema:          db.schema,
	}
}

// sameTime reports whether two optional times are both unset or equal.
func sameTime(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

// Modes of the stand-in for the stack's Auth: it deleted the user (200 {}); it no longer has it (its precise 404
// user_not_found); it failed (500); it refused the credential (401); or it deleted the user but its answer was lost,
// the connection closing before any byte of it.
const (
	authDeleted  = "deleted"
	authNotFound = "user_not_found"
	authFailed   = "failed"
	authRefused  = "refused"
	authLost     = "lost"
)

// authRequest is one request the stand-in got: method, path and query, bearer credential, and body.
type authRequest struct{ method, target, bearer, body string }

// standIn is a loopback stand-in for the stack's GoTrue admin API. It answers DELETE /admin/users/{id} as its mode
// says, any other request with a 404, and records every request, so a test sees exactly what the tool asked of Auth.
type standIn struct {
	srv      *httptest.Server
	mu       sync.Mutex
	mode     string
	requests []authRequest
}

func newStandIn(t *testing.T, mode string) *standIn {
	t.Helper()
	a := &standIn{mode: mode}
	a.srv = httptest.NewServer(http.HandlerFunc(a.serve))
	t.Cleanup(a.srv.Close)
	return a
}

func (a *standIn) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, 4<<10))
	a.mu.Lock()
	a.requests = append(a.requests, authRequest{method: r.Method, target: r.URL.RequestURI(),
		bearer: strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), body: string(body)})
	mode := a.mode
	a.mu.Unlock()
	answer := func(status int, doc string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, doc)
	}
	if r.Method != http.MethodDelete || !strings.HasPrefix(r.URL.Path, "/admin/users/") {
		answer(http.StatusNotFound, `{"code":404,"error_code":"not_found","msg":"no such route"}`)
		return
	}
	switch mode {
	case authDeleted:
		answer(http.StatusOK, `{}`)
	case authNotFound:
		answer(http.StatusNotFound, `{"code":404,"error_code":"user_not_found","msg":"User not found"}`)
	case authFailed:
		answer(http.StatusInternalServerError, `{"code":500,"error_code":"unexpected_failure","msg":"Unexpected failure"}`)
	case authRefused:
		answer(http.StatusUnauthorized, `{"code":401,"error_code":"no_authorization","msg":"This endpoint requires a valid Bearer token"}`)
	case authLost:
		if hj, ok := w.(http.Hijacker); ok {
			if conn, _, err := hj.Hijack(); err == nil {
				conn.Close()
				return
			}
		}
		answer(http.StatusInternalServerError, `{}`)
	}
}

func (a *standIn) setMode(mode string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.mode = mode
}

// take returns the requests the stand-in got since the last take.
func (a *standIn) take() []authRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	got := a.requests
	a.requests = nil
	return got
}

// exportEnv is a complete export configuration for db: its database and the trusted issuer, nothing else of Auth.
func exportEnv(t *testing.T, db *toolDB) map[string]string {
	t.Helper()
	env := databaseEnv(t, db)
	env[config.EnvSupabaseIssuer] = toolIssuer
	return env
}

// replayEnv is a complete replay configuration for db against the Auth at authURL, which AYA_AUTH_HOSTS lists by its
// host:port, signing as issuer for audience, with its admin credential in the private file adminKeyFile.
func replayEnv(t *testing.T, db *toolDB, authURL, issuer, audience, adminKeyFile string) map[string]string {
	t.Helper()
	u, err := url.Parse(authURL)
	if err != nil || u.Host == "" {
		t.Fatal("the Auth base URL is unusable")
	}
	env := databaseEnv(t, db)
	env[config.EnvSupabaseURL] = authURL
	env[config.EnvAuthHosts] = u.Host
	env[config.EnvSupabaseIssuer] = issuer
	env[config.EnvSupabaseAudience] = audience
	env[config.EnvSupabaseAdminKeyFile] = adminKeyFile
	return env
}

// standInEnv is a replay configuration against the stand-in, whose admin credential toolAdminKey is in a private file.
func standInEnv(t *testing.T, db *toolDB, a *standIn) map[string]string {
	t.Helper()
	return replayEnv(t, db, a.srv.URL, toolIssuer, "authenticated", privateFile(t, "admin-key", toolAdminKey+"\n", 0o600))
}

// toolRun is one run of the tool: its exit status and outputs.
type toolRun struct {
	code           int
	stdout, stderr string
}

func runTool(t *testing.T, env map[string]string, args ...string) toolRun {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(context.Background(), args, lookupIn(env), &out, &errOut)
	return toolRun{code: code, stdout: out.String(), stderr: errOut.String()}
}

// quotes reports whether the run's output quotes any of secrets.
func (r toolRun) quotes(secrets ...string) bool {
	for _, s := range secrets {
		if s != "" && (strings.Contains(r.stdout, s) || strings.Contains(r.stderr, s)) {
			return true
		}
	}
	return false
}

// shown renders the run for a failure message, withholding its output if it quotes any of secrets.
func (r toolRun) shown(secrets ...string) string {
	if r.quotes(secrets...) {
		return fmt.Sprintf("exit %d (output withheld: it quotes what it must not)", r.code)
	}
	return fmt.Sprintf("exit %d, stdout %q, stderr %q", r.code, r.stdout, r.stderr)
}

// wantQuiet fails the test if the run's output quotes any of secrets: a connection string, a password, a credential, an
// identity's subject or email, a path, or an answer of Auth.
func (r toolRun) wantQuiet(t *testing.T, secrets ...string) {
	t.Helper()
	if r.quotes(secrets...) {
		t.Fatal("the tool's output quotes a connection string, password, credential, identity, path or answer of Auth")
	}
}

// wantLine fails the test unless stdout has a line that names the deletion and says state.
func wantLine(t *testing.T, stdout, deletionID, state string) {
	t.Helper()
	for _, line := range strings.Split(stdout, "\n") {
		if strings.Contains(line, deletionID) && strings.Contains(line, state) {
			return
		}
	}
	t.Fatalf("stdout has no line naming a deletion of the ledger with %q", state)
}

// wantDeletes fails the test unless got is exactly one hard DELETE /admin/users/<subject> per entry, each with the
// server-only admin credential, and nothing else: no lookup, listing, sign-in or recovery.
func wantDeletes(t *testing.T, got []authRequest, entries []toolEntry) {
	t.Helper()
	if len(got) != len(entries) {
		t.Fatalf("Auth got %d requests, want exactly one deletion per ledger entry (%d)", len(got), len(entries))
	}
	for _, e := range entries {
		n := 0
		for _, r := range got {
			if r.method != http.MethodDelete || r.target != "/admin/users/"+e.subject {
				continue
			}
			n++
			if r.bearer != toolAdminKey {
				t.Fatal("an identity deletion did not carry the server-only admin credential")
			}
			if !strings.Contains(strings.ReplaceAll(r.body, " ", ""), `"should_soft_delete":false`) {
				t.Fatal("an identity deletion is not a hard delete")
			}
		}
		if n != 1 {
			t.Fatalf("Auth got %d deletions of an entry's exact identity, want exactly one", n)
		}
	}
}

// Every refusal exits 1 before anything is written or asked of Auth, with nothing on stdout and a stderr that names the
// setting, the ledger file or the documented refusal and quotes nothing it must not: usage errors; the database URL in
// the environment, a database URL or admin credential file that is not private, the admin credential given to an
// export, an emulator variable even empty, an Auth URL outside AYA_AUTH_HOSTS; a ledger file that is relative or already
// there for an export, or not private, a link or absent for a replay; and a ledger that is invalid, of another issuer,
// or contradicts the database, whose valid entry is then not replayed either.
func TestLedgerToolRefusesWithoutWritingOrAskingAuth(t *testing.T) {
	db := openToolDB(t)
	auth := newStandIn(t, authDeleted)
	accountID, subject, other := newUUID(t), newUUID(t), newUUID(t)
	db.account(t, accountID, toolIssuer, subject)
	db.seedOwned(t, accountID, "r1")
	db.account(t, other, toolIssuer, newUUID(t))
	entry := toolEntry{accountID: accountID, subject: subject, deletionID: newUUID(t), attempts: 1, deletedAt: at(61 * time.Minute)}
	// contradicting names the account other under another subject than its own.
	contradicting := toolEntry{accountID: other, subject: newUUID(t), deletionID: newUUID(t), attempts: 1}
	valid := ledgerDocument(toolIssuer, entry)

	export := func(t *testing.T) map[string]string { return exportEnv(t, db) }
	replay := func(t *testing.T) map[string]string { return standInEnv(t, db, auth) }
	with := func(base func(*testing.T) map[string]string, name string, value func(*testing.T) string) func(*testing.T) map[string]string {
		return func(t *testing.T) map[string]string {
			env := base(t)
			env[name] = value(t)
			return env
		}
	}
	fixed := func(v string) func(*testing.T) string { return func(*testing.T) string { return v } }
	newFile := func(t *testing.T) string { return filepath.Join(t.TempDir(), "ledger.json") }
	args := func(a ...string) func(*testing.T) []string { return func(*testing.T) []string { return a } }
	exportTo := func(t *testing.T) []string { return []string{"export", newFile(t)} }
	replayOf := func(doc string, mode os.FileMode) func(*testing.T) []string {
		return func(t *testing.T) []string { return []string{"replay", privateFile(t, "ledger.json", doc, mode)} }
	}
	usage, ledgerFile := "usage: ayailmu-ledger", "ledger file"
	for _, c := range []struct {
		name  string
		env   func(*testing.T) map[string]string
		args  func(*testing.T) []string
		names string
	}{
		{"no command", export, args(), usage},
		{"an unknown command", export, func(t *testing.T) []string { return []string{"restore", newFile(t)} }, usage},
		{"export without its file", export, args("export"), usage},
		{"export with two files", export, func(t *testing.T) []string { return []string{"export", newFile(t), newFile(t)} }, usage},
		{"replay without its file", replay, args("replay"), usage},
		{"export: the database URL in the environment", with(export, config.EnvDatabaseURL, fixed(db.dbURL)), exportTo, config.EnvDatabaseURL},
		{"export: a database URL file readable by everyone", with(export, config.EnvDatabaseURLFile, func(t *testing.T) string {
			return privateFile(t, "database-url", db.dbURL, 0o644)
		}), exportTo, config.EnvDatabaseURLFile},
		{"export: given the admin credential file", with(export, config.EnvSupabaseAdminKeyFile, func(t *testing.T) string {
			return privateFile(t, "admin-key", toolAdminKey, 0o600)
		}), exportTo, config.EnvSupabaseAdminKeyFile},
		{"export: an emulator variable, even empty", with(export, config.EnvEmulatorHost, fixed("")), exportTo, config.EnvEmulatorHost},
		{"export: a relative ledger file", export, args("export", "ledger.json"), ledgerFile},
		{"export: a ledger file that is already there", export, func(t *testing.T) []string {
			return []string{"export", privateFile(t, "ledger.json", "kept as it is", 0o600)}
		}, ledgerFile},
		{"replay: an Auth URL outside AYA_AUTH_HOSTS", with(replay, config.EnvAuthHosts, fixed("aya-auth:9999")), replayOf(valid, 0o600), config.EnvSupabaseURL},
		{"replay: an admin credential file readable by everyone", with(replay, config.EnvSupabaseAdminKeyFile, func(t *testing.T) string {
			return privateFile(t, "admin-key", toolAdminKey, 0o644)
		}), replayOf(valid, 0o600), config.EnvSupabaseAdminKeyFile},
		{"replay: a ledger file readable by everyone", replay, replayOf(valid, 0o644), ledgerFile},
		{"replay: a ledger file that is a link", replay, func(t *testing.T) []string {
			link := filepath.Join(t.TempDir(), "ledger-link.json")
			if err := os.Symlink(privateFile(t, "ledger.json", valid, 0o600), link); err != nil {
				t.Fatal(err)
			}
			return []string{"replay", link}
		}, ledgerFile},
		{"replay: no such ledger file", replay, func(t *testing.T) []string {
			return []string{"replay", filepath.Join(t.TempDir(), "absent.json")}
		}, ledgerFile},
		{"replay: a ledger with an email", replay,
			replayOf(strings.Replace(valid, `"subject":`, `"email":"aya-ledger@example.test","subject":`, 1), 0o600), store.ErrLedgerInvalid.Error()},
		{"replay: a ledger of another issuer", replay,
			replayOf(ledgerDocument("https://securetoken.google.com/demo-ayailmu", entry), 0o600), store.ErrLedgerInvalid.Error()},
		{"replay: a ledger that contradicts the database", replay,
			replayOf(ledgerDocument(toolIssuer, entry, contradicting), 0o600), store.ErrLedgerConflict.Error()},
	} {
		t.Run(c.name, func(t *testing.T) {
			env, args := c.env(t), c.args(t)
			before := db.digest(t)
			secrets := []string{db.dbURL, db.password, toolAdminKey, subject, contradicting.subject, "example.test"}
			for _, v := range env {
				if filepath.IsAbs(v) {
					secrets = append(secrets, v)
				}
			}
			kept := map[string][]byte{}
			var fresh []string
			for _, a := range args {
				if !filepath.IsAbs(a) {
					if strings.HasSuffix(a, ".json") {
						fresh = append(fresh, a) // a relative file must not appear beside the test either
					}
					continue
				}
				secrets = append(secrets, a)
				if content, err := os.ReadFile(a); err == nil {
					kept[a] = content
				} else if _, err := os.Lstat(a); errors.Is(err, os.ErrNotExist) {
					fresh = append(fresh, a)
				}
			}
			r := runTool(t, env, args...)
			switch {
			case r.code != 1:
				t.Fatalf("a refused run = %s, want exit 1", r.shown(secrets...))
			case r.stdout != "":
				t.Fatalf("a refused run printed on stdout: %s", r.shown(secrets...))
			case !strings.Contains(r.stderr, c.names):
				t.Fatalf("stderr does not name %s: %s", c.names, r.shown(secrets...))
			}
			r.wantQuiet(t, secrets...)
			if db.digest(t) != before {
				t.Fatal("a refused run wrote to the database")
			}
			if got := auth.take(); len(got) != 0 {
				t.Fatalf("a refused run sent %d requests to Auth", len(got))
			}
			for path, content := range kept {
				if now, err := os.ReadFile(path); err != nil || !bytes.Equal(now, content) {
					t.Fatal("a refused run changed a file it was given")
				}
			}
			for _, path := range fresh {
				if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("a refused run created a file")
				}
			}
		})
	}
}

// export writes the ledger of every recorded deletion into a new file that it creates private (0600), reading only: the
// database is unchanged, an account that was not deleted is not in the file, and the file decodes as the trusted
// provider's ledger with each deletion's exact anchor and record. stdout gives only how many deletions the ledger
// carries and the file's SHA-256, and quotes no ID of it.
func TestLedgerToolExportWritesAPrivateLedgerFileReadingOnly(t *testing.T) {
	db := openToolDB(t)
	confirmed := toolEntry{accountID: newUUID(t), subject: newUUID(t), deletionID: newUUID(t), attempts: 1, deletedAt: at(61 * time.Minute)}
	pending := toolEntry{accountID: newUUID(t), subject: newUUID(t), deletionID: newUUID(t), attempts: 2, lastFailureAt: at(2 * time.Hour)}
	for _, e := range []toolEntry{confirmed, pending} {
		db.account(t, e.accountID, toolIssuer, e.subject)
		db.exec(t, `INSERT INTO account_deletions (account_id, deletion_id, requested_at, erased_profiles, erased_device_links, erased_events,
			erased_imports, identity_attempts, identity_deleted_at, identity_last_failure_at) VALUES ($1::uuid, $2::uuid, $3, 1, 1, 2, 1, $4, $5, $6)`,
			e.accountID, e.deletionID, toolBase.Add(time.Hour), e.attempts, e.deletedAt, e.lastFailureAt)
	}
	active, activeSubject := newUUID(t), newUUID(t)
	db.account(t, active, toolIssuer, activeSubject)
	db.seedOwned(t, active, "e1")
	before := db.digest(t)
	path := filepath.Join(t.TempDir(), "ledger.json")
	env := exportEnv(t, db)
	secrets := []string{db.dbURL, db.password, env[config.EnvDatabaseURLFile], path, confirmed.subject, pending.subject, activeSubject,
		confirmed.accountID, pending.accountID, confirmed.deletionID, pending.deletionID}

	r := runTool(t, env, "export", path)
	if r.code != 0 {
		t.Fatalf("export = %s, want exit 0", r.shown(secrets...))
	}
	r.wantQuiet(t, secrets...)
	if db.digest(t) != before {
		t.Fatal("the export wrote to the database")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		t.Fatal("the ledger file is not a regular file of mode 0600")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("the ledger file cannot be read")
	}
	sum := sha256.Sum256(raw)
	if !strings.Contains(r.stdout, "2 deletions") || !strings.Contains(r.stdout, hex.EncodeToString(sum[:])) {
		t.Fatalf("stdout does not give the ledger's 2 deletions and the file's SHA-256: %s", r.shown(secrets...))
	}
	if bytes.Contains(raw, []byte(active)) || bytes.Contains(raw, []byte(activeSubject)) {
		t.Fatal("the ledger carries an account that was not deleted")
	}
	l, err := store.DecodeDeletionLedger(bytes.NewReader(raw), store.LedgerAnchor{AuthMode: "local-supabase", Issuer: toolIssuer})
	if err != nil {
		t.Fatalf("the ledger file does not decode as the trusted provider's ledger: %v", err)
	}
	if len(l.Entries) != 2 {
		t.Fatalf("the ledger carries %d entries, want the 2 recorded deletions", len(l.Entries))
	}
	for _, e := range l.Entries {
		want := confirmed
		if e.AccountID == pending.accountID {
			want = pending
		}
		if e.AccountID != want.accountID || e.Subject != want.subject || e.DeletionID != want.deletionID || e.IdentityAttempts != want.attempts ||
			!sameTime(e.IdentityDeletedAt, want.deletedAt) || !sameTime(e.IdentityLastFailureAt, want.lastFailureAt) {
			t.Fatal("a ledger entry is not its account's exact anchor and record")
		}
	}
}

// replay deletes each entry's exact identity once per run, after the replay committed, with the server credential: one
// hard DELETE /admin/users/<subject> per entry and no other request, even for an entry whose ledger already records the
// confirmation. Auth's success confirms it: exit 0. A failure, a refused credential, or a success whose answer was lost
// leaves it pending, exit 3, with the replay committed all the same (resurrected data erased, every anchor and tombstone
// kept, a bystander untouched), each attempt counted with its failure time, and no confirmation, the ledger's included,
// set or cleared. A later replay that Auth confirms with its precise user_not_found exits 0 and records the
// confirmation, keeping the ledger's first one.
func TestLedgerToolReplayReportsAnUnconfirmedIdentityDeletionAsPending(t *testing.T) {
	for _, mode := range []string{authDeleted, authFailed, authRefused, authLost} {
		t.Run(mode, func(t *testing.T) {
			db := openToolDB(t)
			auth := newStandIn(t, mode)
			// resurrected: the restore holds the account and its data, and the ledger records its identity's deletion
			// as confirmed.
			resurrected := toolEntry{accountID: newUUID(t), subject: newUUID(t), deletionID: newUUID(t), attempts: 1, deletedAt: at(61 * time.Minute)}
			db.account(t, resurrected.accountID, toolIssuer, resurrected.subject)
			db.seedOwned(t, resurrected.accountID, "p1")
			// unborn: the restore predates the account; the ledger's identity step was pending after a failed attempt.
			unborn := toolEntry{accountID: newUUID(t), subject: newUUID(t), deletionID: newUUID(t), attempts: 1, lastFailureAt: at(62 * time.Minute)}
			bystander, bystanderSubject := newUUID(t), newUUID(t)
			db.account(t, bystander, toolIssuer, bystanderSubject)
			db.seedOwned(t, bystander, "p2")
			entries := []toolEntry{resurrected, unborn}
			env := standInEnv(t, db, auth)
			ledger := privateFile(t, "ledger.json", ledgerDocument(toolIssuer, entries...), 0o600)
			secrets := []string{db.dbURL, db.password, toolAdminKey, env[config.EnvDatabaseURLFile], env[config.EnvSupabaseAdminKeyFile], ledger,
				resurrected.subject, unborn.subject, bystanderSubject, "user_not_found", "unexpected_failure", "no_authorization"}
			wantCode, wantState := 3, "identity pending"
			if mode == authDeleted {
				wantCode, wantState = 0, "identity deleted"
			}

			started := time.Now()
			r := runTool(t, env, "replay", ledger)
			if r.code != wantCode {
				t.Fatalf("replay = %s, want exit %d", r.shown(secrets...), wantCode)
			}
			r.wantQuiet(t, secrets...)
			wantDeletes(t, auth.take(), entries)
			for _, e := range entries {
				wantLine(t, r.stdout, e.deletionID, wantState)
				if n := db.ownedRows(t, e.accountID); n != [4]int64{} {
					t.Fatalf("the replay left %v of an account's resurrected rows", n)
				}
				rec := db.identity(t, e.accountID)
				switch {
				case !rec.found || rec.deletionID != e.deletionID:
					t.Fatal("the replay left an account without the ledger's tombstone")
				case rec.attempts != e.attempts+1:
					t.Fatalf("the tombstone counts %d identity attempts, want the ledger's %d and this run's one", rec.attempts, e.attempts)
				case mode == authDeleted && (rec.deletedAt == nil || (e.deletedAt != nil && !rec.deletedAt.Equal(*e.deletedAt))):
					t.Fatal("the confirmed attempt is not recorded, or the ledger's first confirmation was replaced")
				case mode == authDeleted && !sameTime(rec.lastFailureAt, e.lastFailureAt):
					t.Fatal("a confirmed attempt recorded a failure")
				case mode != authDeleted && !sameTime(rec.deletedAt, e.deletedAt):
					t.Fatal("an unconfirmed attempt set or cleared the identity's confirmation")
				case mode != authDeleted && (rec.lastFailureAt == nil || rec.lastFailureAt.Before(started.Add(-time.Minute))):
					t.Fatal("the unconfirmed attempt's failure time is not recorded")
				}
			}
			if n := db.ownedRows(t, bystander); n != [4]int64{1, 1, 2, 1} {
				t.Fatalf("the replay changed a bystander's rows (%v left)", n)
			}
			if mode == authDeleted {
				return
			}

			auth.setMode(authNotFound)
			again := runTool(t, env, "replay", ledger)
			if again.code != 0 {
				t.Fatalf("a replay that Auth confirms with user_not_found = %s, want exit 0", again.shown(secrets...))
			}
			again.wantQuiet(t, secrets...)
			wantDeletes(t, auth.take(), entries)
			for _, e := range entries {
				wantLine(t, again.stdout, e.deletionID, "identity deleted")
				rec := db.identity(t, e.accountID)
				if rec.attempts != e.attempts+2 || rec.deletedAt == nil || (e.deletedAt != nil && !rec.deletedAt.Equal(*e.deletedAt)) {
					t.Fatal("the confirming replay did not record its attempt and the first confirmation")
				}
			}
		})
	}
}

// realFixture is the real GoTrue fixture as its fixture.env describes it: Auth's loopback base URL, the issuer and
// audience it signs with, and the private admin credential file, whose credential the test reads only to create and
// remove its own users.
type realFixture struct{ url, issuer, audience, adminKeyFile, adminKey string }

// realAuthFixture reads the fixture.env that AYA_REAL_AUTH_FIXTURE names. A missing, unsafe or incomplete fixture fails
// the test; nothing is skipped and nothing read is printed.
func realAuthFixture(t *testing.T) realFixture {
	t.Helper()
	path := os.Getenv("AYA_REAL_AUTH_FIXTURE")
	if path == "" {
		t.Fatal("AYA_REAL_AUTH_FIXTURE is not set: this test needs the real GoTrue fixture (phase4_real_auth_fixture.py up); refusing to skip")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		t.Fatal("AYA_REAL_AUTH_FIXTURE does not name a private regular file (0600 or 0400)")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("the real GoTrue fixture file cannot be read")
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		if line == "" {
			continue
		}
		name, value, ok := strings.Cut(line, "=")
		if !ok {
			t.Fatal("the real GoTrue fixture file has a line that is not NAME=value")
		}
		values[name] = value
	}
	fx := realFixture{url: values[config.EnvSupabaseURL], issuer: values[config.EnvSupabaseIssuer], audience: values[config.EnvSupabaseAudience],
		adminKeyFile: values[config.EnvSupabaseAdminKeyFile]}
	if fx.url == "" || fx.issuer == "" || fx.audience == "" || fx.adminKeyFile == "" {
		t.Fatal("the real GoTrue fixture file does not set Auth's URL, issuer, audience and admin credential file")
	}
	key, err := os.ReadFile(fx.adminKeyFile)
	if err != nil || len(key) == 0 {
		t.Fatal("the real GoTrue fixture's admin credential file cannot be read")
	}
	fx.adminKey = strings.TrimSuffix(string(key), "\n")
	return fx
}

// fixtureHTTP is the test's own client of the real Auth: direct, never through a proxy.
var fixtureHTTP = &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{}}

// admin sends one admin API request to the real Auth with the fixture's server credential and returns the status and
// body, of at most 1 MiB; neither the credential nor the answer is printed.
func (fx realFixture) admin(t *testing.T, method, path string, body any) (int, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, fx.url+path, rd)
	if err != nil {
		t.Fatal("the real GoTrue fixture's base URL is unusable")
	}
	req.Header.Set("Authorization", "Bearer "+fx.adminKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := fixtureHTTP.Do(req)
	if err != nil {
		t.Fatal("the real GoTrue fixture did not answer an admin request")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		t.Fatal("the real GoTrue fixture's answer was cut short")
	}
	return resp.StatusCode, raw
}

// createUser creates one owned, confirmed synthetic user through the admin API, and removes it when the test ends
// unless it is gone already.
func (fx realFixture) createUser(t *testing.T) (id, email, password string) {
	t.Helper()
	email, password = "aya-ledger-"+randomHex(t, 8)+"@example.test", "pw-"+randomHex(t, 16)
	status, raw := fx.admin(t, http.MethodPost, "/admin/users",
		map[string]any{"email": email, "password": password, "email_confirm": true, "role": "authenticated"})
	var created struct {
		ID string `json:"id"`
	}
	if status != http.StatusOK || json.Unmarshal(raw, &created) != nil || len(created.ID) != 36 {
		t.Fatalf("the real Auth did not create an owned synthetic user (status %d)", status)
	}
	t.Cleanup(func() {
		if status, _ := fx.admin(t, http.MethodDelete, "/admin/users/"+created.ID, map[string]bool{"should_soft_delete": false}); status != http.StatusOK && status != http.StatusNotFound {
			t.Errorf("cleanup: the real Auth answered %d to deleting an owned synthetic user", status)
		}
	})
	return created.ID, email, password
}

// exists reports whether the real Auth still has the user: 200 with its ID, or the precise 404 user_not_found. Anything
// else fails the test.
func (fx realFixture) exists(t *testing.T, id string) bool {
	t.Helper()
	status, raw := fx.admin(t, http.MethodGet, "/admin/users/"+id, nil)
	var doc struct {
		ID        string `json:"id"`
		ErrorCode string `json:"error_code"`
	}
	_ = json.Unmarshal(raw, &doc)
	switch {
	case status == http.StatusOK && doc.ID == id:
		return true
	case status == http.StatusNotFound && doc.ErrorCode == "user_not_found":
		return false
	}
	t.Fatalf("the real Auth's admin lookup answered %d, neither the user nor user_not_found", status)
	return false
}

// Against the pinned real GoTrue v2.197.0 fixture, a replay deletes an identity that a restored Auth holds again
// although the ledger records its deletion as confirmed: through the admin API, by the exact subject under the
// fixture's issuer, with the server credential the tool reads from its private file. The account's resurrected rows are
// erased and its tombstone keeps the ledger's first confirmation. Another user of the same Auth stays, and so do its
// account's rows. A second replay is confirmed by Auth's precise user_not_found and exits 0 again, erasing nothing.
func TestLedgerToolReplayDeletesAResurrectedIdentityAtTheRealAuth(t *testing.T) {
	fx := realAuthFixture(t)
	db := openToolDB(t)
	resurrected, email, password := fx.createUser(t)
	bystanderUser, bystanderEmail, bystanderPassword := fx.createUser(t)
	accountID, bystander := newUUID(t), newUUID(t)
	db.account(t, accountID, fx.issuer, resurrected)
	db.seedOwned(t, accountID, "g1")
	db.account(t, bystander, fx.issuer, bystanderUser)
	db.seedOwned(t, bystander, "g2")
	entry := toolEntry{accountID: accountID, subject: resurrected, deletionID: newUUID(t), attempts: 1, deletedAt: at(61 * time.Minute)}
	ledger := privateFile(t, "ledger.json", ledgerDocument(fx.issuer, entry), 0o600)
	env := replayEnv(t, db, fx.url, fx.issuer, fx.audience, fx.adminKeyFile)
	secrets := []string{db.dbURL, db.password, fx.adminKey, fx.adminKeyFile, env[config.EnvDatabaseURLFile], ledger,
		resurrected, bystanderUser, email, password, bystanderEmail, bystanderPassword, "user_not_found"}
	if !fx.exists(t, resurrected) {
		t.Fatal("premise: the restored Auth does not hold the identity")
	}

	r := runTool(t, env, "replay", ledger)
	if r.code != 0 {
		t.Fatalf("replay against the real Auth = %s, want exit 0", r.shown(secrets...))
	}
	r.wantQuiet(t, secrets...)
	wantLine(t, r.stdout, entry.deletionID, "identity deleted")
	if fx.exists(t, resurrected) {
		t.Fatal("the replay left the resurrected identity at Auth")
	}
	if !fx.exists(t, bystanderUser) {
		t.Fatal("the replay deleted another user of the same Auth")
	}
	if n := db.ownedRows(t, accountID); n != [4]int64{} {
		t.Fatalf("the replay left %v of the account's resurrected rows", n)
	}
	if n := db.ownedRows(t, bystander); n != [4]int64{1, 1, 2, 1} {
		t.Fatalf("the replay changed a bystander's rows (%v left)", n)
	}
	if rec := db.identity(t, accountID); !rec.found || rec.deletionID != entry.deletionID || rec.attempts != 2 || !sameTime(rec.deletedAt, entry.deletedAt) {
		t.Fatal("the tombstone does not record this run's confirmed attempt beside the ledger's first confirmation")
	}

	again := runTool(t, env, "replay", ledger)
	if again.code != 0 {
		t.Fatalf("a second replay against the real Auth = %s, want exit 0", again.shown(secrets...))
	}
	again.wantQuiet(t, secrets...)
	wantLine(t, again.stdout, entry.deletionID, "identity deleted")
	if rec := db.identity(t, accountID); rec.attempts != 3 || !sameTime(rec.deletedAt, entry.deletedAt) {
		t.Fatal("the second replay did not record its confirmed attempt, or replaced the first confirmation")
	}
	if !fx.exists(t, bystanderUser) {
		t.Fatal("a second replay deleted another user of the same Auth")
	}
}
