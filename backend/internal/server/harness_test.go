package server_test

// Shared fixtures for the local HTTP/PostgreSQL/auth integration suite. Every test runs the real service
// against the isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) in its own fresh aya_t_ schema, which
// it drops on cleanup, and against the real local Auth emulator (FIREBASE_AUTH_EMULATOR_HOST) with
// synthetic example.test users. Missing infrastructure fails the test; nothing is skipped. No DSN,
// token or password is ever printed.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

const (
	testProject = "demo-ayailmu"
	testIssuer  = "https://securetoken.google.com/" + testProject
	// The Auth emulator accepts any API key; this one is a label, not a credential.
	emulatorAPIKey = "demo-ayailmu-local-test-key"
)

var (
	httpClient = &http.Client{Timeout: 30 * time.Second}
	uuidRE     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	sha256RE   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	// baseTime is when synthetic answers were recorded unless a test says otherwise.
	baseTime = time.Date(2026, 10, 16, 2, 0, 0, 0, time.UTC)
	// sadiqun is صَادِقٌ, assembled from code points so no editor or transport can alter it.
	sadiqun = string([]rune{0x0635, 0x064e, 0x0627, 0x062f, 0x0650, 0x0642, 0x064c})
)

func randomHex(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("random: %v", err)
	}
	return hex.EncodeToString(b)
}

// infra returns the locally injected infrastructure. It fails, never skips, when either is missing.
func infra(t *testing.T) (dbURL, emulatorHost string) {
	t.Helper()
	dbURL, emulatorHost = os.Getenv("AYA_TEST_DATABASE_URL"), os.Getenv("FIREBASE_AUTH_EMULATOR_HOST")
	if dbURL == "" {
		t.Fatal("AYA_TEST_DATABASE_URL is not set: these tests need the isolated loopback PostgreSQL; refusing to skip")
	}
	if emulatorHost == "" {
		t.Fatal("FIREBASE_AUTH_EMULATOR_HOST is not set: these tests need the local Auth emulator (project demo-ayailmu); refusing to skip")
	}
	return dbURL, emulatorHost
}

func lookupIn(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

// serviceEnv is a complete, valid local configuration.
func serviceEnv(dbURL, emulatorHost, schema, listen string) map[string]string {
	return map[string]string{
		config.EnvMode:         config.ModeEmulator,
		config.EnvListen:       listen,
		config.EnvDatabaseURL:  dbURL,
		config.EnvSchema:       schema,
		config.EnvProjectID:    testProject,
		config.EnvEmulatorHost: emulatorHost,
	}
}

func newSchemaName(t *testing.T) string {
	return "aya_t_" + randomHex(t, 6)
}

// fixturePool is a guarded direct pool on schema, for seeding synthetic rows and checking what was or
// was not written.
func fixturePool(t *testing.T, dbURL, schema string) *pgxpool.Pool {
	t.Helper()
	cfg, err := store.ParseConfig(dbURL, schema)
	if err != nil {
		t.Fatalf("fixture database config: %v", err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("fixture database pool: %v", err)
	}
	return pool
}

// dropSchema removes one test-owned aya_t_ schema and nothing else.
func dropSchema(t *testing.T, pool *pgxpool.Pool, schema string) {
	t.Helper()
	if !strings.HasPrefix(schema, "aya_t_") {
		t.Fatal("refusing to drop a schema this test does not own")
	}
	if _, err := pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE"); err != nil {
		t.Errorf("drop test schema: %v", err)
	}
}

func schemaExists(t *testing.T, pool *pgxpool.Pool, schema string) bool {
	t.Helper()
	var ok bool
	if err := pool.QueryRow(context.Background(), "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1)", schema).Scan(&ok); err != nil {
		t.Fatalf("check schema: %v", err)
	}
	return ok
}

// stack is one real service on a fresh schema, served on a loopback listener whose address is
// AYA_LISTEN, so the Host allow-list matches real requests.
type stack struct {
	dbURL, emu, schema string
	opts               server.Options
	svc                *server.Service
	srv                *httptest.Server
	host, base         string
	db                 *pgxpool.Pool
}

func newStack(t *testing.T, opts server.Options) *stack {
	t.Helper()
	dbURL, emu := infra(t)
	s := &stack{dbURL: dbURL, emu: emu, schema: newSchemaName(t), opts: opts}
	s.db = fixturePool(t, dbURL, s.schema)
	t.Cleanup(func() {
		dropSchema(t, s.db, s.schema)
		s.db.Close()
	})
	// The owning test stops whichever service is current when it ends, before the schema cleanup above
	// (cleanups run last-registered first). A reopen inside a subtest therefore never ties the shared
	// service to that subtest's lifetime.
	t.Cleanup(s.stop)
	s.start(t)
	return s
}

func (s *stack) start(t *testing.T) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen on loopback: %v", err)
	}
	host := ln.Addr().String()
	svc, err := server.New(context.Background(), lookupIn(serviceEnv(s.dbURL, s.emu, s.schema, host)), s.opts)
	if err != nil {
		ln.Close()
		t.Fatalf("server.New: %v", err)
	}
	srv := httptest.NewUnstartedServer(svc.Handler())
	srv.Listener.Close()
	srv.Listener = ln
	srv.Start()
	s.svc, s.srv, s.host, s.base = svc, srv, host, "http://"+host
}

// stop closes the current service, if any. It reads the stack when called, so it stops the latest
// reopened service, and calling it again is harmless.
func (s *stack) stop() {
	if s.srv != nil {
		s.srv.Close()
		s.srv = nil
	}
	if s.svc != nil {
		s.svc.Close()
		s.svc = nil
	}
}

// reopen stops the service and builds a new one on the same schema. PostgreSQL keeps running. t is used
// only to report failures: the test that created the stack still owns the reopened service.
func (s *stack) reopen(t *testing.T) {
	t.Helper()
	s.stop()
	s.start(t)
}

type user struct{ uid, token string }

// emulatorPost calls the emulator's Identity Toolkit REST API.
func emulatorPost(t *testing.T, host, method string, body, out any) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := httpClient.Post("http://"+host+"/identitytoolkit.googleapis.com/v1/"+method+"?key="+emulatorAPIKey, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("auth emulator %s: %v", method, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		t.Fatalf("auth emulator %s: status %d (%s)", method, resp.StatusCode, e.Error.Message)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("auth emulator %s: decode response: %v", method, err)
	}
}

// newUser signs up a synthetic example.test account and signs in with its password, so the token is a
// real emulator-issued password token.
func newUser(t *testing.T, emu string) user {
	t.Helper()
	email, password := "aya-it-"+randomHex(t, 8)+"@example.test", "pw-"+randomHex(t, 12)
	var up struct {
		LocalID string `json:"localId"`
	}
	emulatorPost(t, emu, "accounts:signUp", map[string]any{"email": email, "password": password, "returnSecureToken": true}, &up)
	var in struct {
		IDToken string `json:"idToken"`
		LocalID string `json:"localId"`
	}
	emulatorPost(t, emu, "accounts:signInWithPassword", map[string]any{"email": email, "password": password, "returnSecureToken": true}, &in)
	if up.LocalID == "" || in.IDToken == "" || in.LocalID != up.LocalID {
		t.Fatal("auth emulator returned no consistent uid or no token")
	}
	t.Cleanup(func() { deleteEmulatorUser(t, emu, up.LocalID) })
	return user{uid: up.LocalID, token: in.IDToken}
}

func anonymousToken(t *testing.T, emu string) string {
	t.Helper()
	var out struct {
		IDToken string `json:"idToken"`
		LocalID string `json:"localId"`
	}
	emulatorPost(t, emu, "accounts:signUp", map[string]any{"returnSecureToken": true}, &out)
	if out.IDToken == "" {
		t.Fatal("auth emulator anonymous sign-up returned no token")
	}
	t.Cleanup(func() { deleteEmulatorUser(t, emu, out.LocalID) })
	return out.IDToken
}

// deleteEmulatorUser removes one synthetic emulator account ("Bearer owner" is the emulator's documented
// local admin placeholder, not a credential). Best effort.
func deleteEmulatorUser(t *testing.T, host, uid string) {
	b, _ := json.Marshal(map[string]string{"localId": uid})
	req, err := http.NewRequest(http.MethodPost, "http://"+host+"/identitytoolkit.googleapis.com/v1/projects/"+testProject+"/accounts:delete", bytes.NewReader(b))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer owner")
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Logf("cleanup: deleting a synthetic emulator user failed: %v", err)
		return
	}
	resp.Body.Close()
}

type reply struct {
	status int
	header http.Header
	body   []byte
}

// send performs one request without touching t, so goroutines can use it. Header pairs override the
// defaults ("Host" sets the Host header); a body defaults to Content-Type application/json.
func (s *stack) send(method, path, token string, body []byte, headers ...string) (reply, error) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, s.base+path, rd)
	if err != nil {
		return reply{}, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		if http.CanonicalHeaderKey(headers[i]) == "Host" {
			req.Host = headers[i+1]
			continue
		}
		req.Header.Set(headers[i], headers[i+1])
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return reply{}, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return reply{}, err
	}
	return reply{status: resp.StatusCode, header: resp.Header, body: b}, nil
}

func (s *stack) call(t *testing.T, method, path, token string, body []byte, headers ...string) reply {
	t.Helper()
	r, err := s.send(method, path, token, body, headers...)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return r
}

func decodeJSON(t *testing.T, b []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("decode response: %v (body %.300q)", err, b)
	}
}

// wantStatus checks the status and that the response may not be cached.
func wantStatus(t *testing.T, r reply, status int) {
	t.Helper()
	if r.status != status {
		t.Fatalf("status = %d, want %d (body %.300q)", r.status, status, r.body)
	}
	if got := r.header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}

type problem struct {
	Type    string          `json:"type"`
	Title   string          `json:"title"`
	Status  int             `json:"status"`
	Code    string          `json:"code"`
	Detail  string          `json:"detail"`
	Current json.RawMessage `json:"current"`
	Results []result        `json:"results"`
}

// wantProblem checks an RFC 9457 problem: status, media type, no-store and the stable code.
func wantProblem(t *testing.T, r reply, status int, code string) problem {
	t.Helper()
	wantStatus(t, r, status)
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("Content-Type = %q, want application/problem+json", ct)
	}
	var p problem
	decodeJSON(t, r.body, &p)
	if p.Status != status || p.Code != code || p.Type == "" || p.Title == "" {
		t.Fatalf("problem = %+v, want status %d and code %s with type and title", p, status, code)
	}
	return p
}

// result is one event's outcome in a batch or an import report.
type result struct {
	Index            int      `json:"index"`
	EventID          string   `json:"event_id"`
	Result           string   `json:"result"`
	Status           int      `json:"status"`
	Code             string   `json:"code"`
	Seq              int64    `json:"seq"`
	ReceivedAt       string   `json:"received_at"`
	SemanticSHA256   string   `json:"semantic_sha256"`
	StoredSHA256     string   `json:"stored_sha256"`
	ReceivedSHA256   string   `json:"received_sha256"`
	CurriculumStatus string   `json:"curriculum_status"`
	ClockFlags       []string `json:"clock_flags"`
}

type batchReply struct {
	Results []result `json:"results"`
	HighSeq int64    `json:"high_seq"`
}

type pulled struct {
	Seq              int64               `json:"seq"`
	EventID          string              `json:"event_id"`
	Kind             string              `json:"kind"`
	Schema           string              `json:"schema"`
	SchemaVersion    int                 `json:"schema_version"`
	Curriculum       envelope.Curriculum `json:"curriculum"`
	CurriculumStatus string              `json:"curriculum_status"`
	Source           envelope.Source     `json:"source"`
	SemanticSHA256   string              `json:"semantic_sha256"`
	ClockFlags       []string            `json:"clock_flags"`
	ReceivedAt       string              `json:"received_at"`
	Payload          json.RawMessage     `json:"payload"`
}

type page struct {
	Events    []pulled `json:"events"`
	NextAfter int64    `json:"next_after"`
	HighSeq   int64    `json:"high_seq"`
	HasMore   bool     `json:"has_more"`
}

type sourceRef struct {
	App            string `json:"app"`
	InstallID      string `json:"install_id"`
	LocalProfileID string `json:"local_profile_id"`
}

type profileDoc struct {
	ProfileID string `json:"profile_id"`
	Kind      string `json:"kind"`
	Revision  int64  `json:"revision"`
	HighSeq   int64  `json:"high_seq"`
	Settings  struct {
		InstructionLang *string  `json:"instruction_lang"`
		SessionMinutes  *int     `json:"session_minutes"`
		ArabicScale     *float64 `json:"arabic_scale"`
	} `json:"settings"`
	Consent struct {
		Version string `json:"version"`
		At      string `json:"at"`
	} `json:"consent"`
	Sources []sourceRef `json:"sources"`
}

type receipt struct {
	ImportID       string `json:"import_id"`
	ProfileID      string `json:"profile_id"`
	ProfileCreated bool   `json:"profile_created"`
	Replayed       bool   `json:"replayed"`
	Stored         int    `json:"stored"`
	Identical      int    `json:"identical"`
	HighSeq        int64  `json:"high_seq"`
	EventIDsSHA256 string `json:"event_ids_sha256"`
	CommittedAt    string `json:"committed_at"`
}

type me struct {
	AccountID string `json:"account_id"`
	Profiles  []struct {
		ProfileID string `json:"profile_id"`
		Revision  int64  `json:"revision"`
		HighSeq   int64  `json:"high_seq"`
	} `json:"profiles"`
}

type counts map[string]int

type progress struct {
	ProfileID  string `json:"profile_id"`
	Family     string `json:"family"`
	AsOfSeq    int64  `json:"as_of_seq"`
	Derivation string `json:"derivation"`
	Learned    struct {
		Status string `json:"status"`
	} `json:"learned"`
	Retention struct {
		Status string `json:"status"`
	} `json:"retention"`
	Events               int            `json:"events"`
	ExcludedUnregistered int            `json:"excluded_unregistered"`
	ClockFlagged         int            `json:"clock_flagged"`
	SourceInstalls       int            `json:"source_installs"`
	Skills               []skillFacts   `json:"skills"`
	Versions             []versionFacts `json:"versions"`
	Provenance           struct {
		Synthetic           counts `json:"synthetic"`
		FeedbackDeferred    counts `json:"feedback_deferred"`
		HintUsed            counts `json:"hint_used"`
		RetentionValidFalse int    `json:"retention_valid_false"`
	} `json:"provenance"`
}

type skillFacts struct {
	Skill                   string `json:"skill"`
	Events                  int    `json:"events"`
	ByOutcome               counts `json:"by_outcome"`
	ByRoleOrPool            counts `json:"by_role_or_pool"`
	EvidenceModes           counts `json:"evidence_modes"`
	DistinctExposureKeys    int    `json:"distinct_exposure_keys"`
	LocalDays               int    `json:"local_days"`
	FreshClaims             int    `json:"fresh_claims"`
	FreshClaimsContradicted int    `json:"fresh_claims_contradicted"`
}

type versionFacts struct {
	ContentVersion string `json:"content_version"`
	RulesVersion   string `json:"rules_version"`
	Events         int    `json:"events"`
	Pack           struct {
		Lifecycle                 string `json:"lifecycle"`
		Synthetic                 bool   `json:"synthetic"`
		ReviewedProductionContent bool   `json:"reviewed_production_content"`
		AnswerFormat              string `json:"answer_format"`
	} `json:"pack"`
}

func (s *stack) upload(t *testing.T, token, pid string, envs ...[]byte) batchReply {
	t.Helper()
	r := s.call(t, http.MethodPost, "/v1/profiles/"+pid+"/events", token, batch(envs...))
	wantStatus(t, r, http.StatusOK)
	var out batchReply
	decodeJSON(t, r.body, &out)
	if len(out.Results) != len(envs) {
		t.Fatalf("a batch of %d returned %d results", len(envs), len(out.Results))
	}
	return out
}

func (s *stack) pull(t *testing.T, token, pid, query string) page {
	t.Helper()
	r := s.call(t, http.MethodGet, "/v1/profiles/"+pid+"/events?"+query, token, nil)
	wantStatus(t, r, http.StatusOK)
	var p page
	decodeJSON(t, r.body, &p)
	return p
}

// profile returns the profile document, its ETag and the raw body.
func (s *stack) profile(t *testing.T, token, pid string) (profileDoc, string, []byte) {
	t.Helper()
	r := s.call(t, http.MethodGet, "/v1/profiles/"+pid, token, nil)
	wantStatus(t, r, http.StatusOK)
	var d profileDoc
	decodeJSON(t, r.body, &d)
	return d, r.header.Get("ETag"), r.body
}

func (s *stack) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// seedProfile writes a synthetic adult profile for u with the given linked sources directly into the
// test schema, so route tests do not depend on the import endpoint. It returns the profile ID.
func (s *stack) seedProfile(t *testing.T, u user, sources ...sourceRef) string {
	t.Helper()
	ctx := context.Background()
	var accountID, profileID string
	if err := s.db.QueryRow(ctx, `INSERT INTO accounts (auth_mode, issuer, subject) VALUES ('emulator', $1, $2)
		ON CONFLICT (issuer, subject) DO UPDATE SET subject = EXCLUDED.subject RETURNING account_id::text`, testIssuer, u.uid).Scan(&accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if err := s.db.QueryRow(ctx, `INSERT INTO profiles (account_id, kind, instruction_lang, session_minutes, arabic_scale, consent_version, consent_at)
		VALUES ($1::uuid, 'adult', 'id', 10, 1.0, 'trial-consent-1', '2026-10-15T00:00:00Z') RETURNING profile_id::text`, accountID).Scan(&profileID); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	for _, src := range sources {
		if _, err := s.db.Exec(ctx, `INSERT INTO profile_sources (account_id, profile_id, app, install_id, local_profile_id)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5)`, accountID, profileID, src.App, src.InstallID, src.LocalProfileID); err != nil {
			t.Fatalf("seed source: %v", err)
		}
	}
	return profileID
}

// seedEvent stores one envelope directly as the next event of pid, with the values the foundation's
// envelope.Parse derives, so read routes are tested without depending on the ingest route.
func (s *stack) seedEvent(t *testing.T, pid string, env []byte) {
	t.Helper()
	ev, err := envelope.Parse(env, curriculum.Default())
	if err != nil {
		t.Fatalf("seed event: %v", err)
	}
	ctx := context.Background()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		t.Fatalf("seed event: %v", err)
	}
	defer tx.Rollback(ctx) // a no-op after Commit
	var seq int64
	if err := tx.QueryRow(ctx, `UPDATE profiles SET high_seq = high_seq + 1 WHERE profile_id = $1::uuid RETURNING high_seq`, pid).Scan(&seq); err != nil {
		t.Fatalf("seed event sequence: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO events (profile_id, seq, event_id, kind, record_schema, schema_version, family, track,
		content_version, rules_version, curriculum_status, occurred_at, local_date, payload_raw, semantic_sha256,
		source_app, source_install_id, source_app_version, source_local_profile_id)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14, $15, $16, $17, $18, $19)`,
		pid, seq, ev.EventID, ev.Kind, ev.Schema, ev.SchemaVersion, ev.Curriculum.Family, ev.Curriculum.Track,
		ev.Curriculum.ContentVersion, ev.Curriculum.RulesVersion, ev.CurriculumStatus, ev.Facts.OccurredAt, ev.Facts.LocalDate,
		string(ev.Payload), ev.SemanticSHA256[:], ev.Source.App, ev.Source.InstallID, ev.Source.AppVersion, ev.Source.LocalProfileID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("seed event: %v", err)
	}
}

// wantNoProfileData checks that u owns no profile, source, import or event row.
func (s *stack) wantNoProfileData(t *testing.T, u user) {
	t.Helper()
	n := s.count(t, `SELECT
		(SELECT count(*) FROM profiles p JOIN accounts a USING (account_id) WHERE a.subject = $1) +
		(SELECT count(*) FROM profile_sources ps JOIN accounts a USING (account_id) WHERE a.subject = $1) +
		(SELECT count(*) FROM imports i JOIN accounts a USING (account_id) WHERE a.subject = $1) +
		(SELECT count(*) FROM events e JOIN profiles p USING (profile_id) JOIN accounts a ON a.account_id = p.account_id WHERE a.subject = $1)`, u.uid)
	if n != 0 {
		t.Fatalf("a refused request left %d profile, source, import or event rows", n)
	}
}

// answer is one synthetic client record. envelope() renders it exactly in the stored client shape of
// the contract goldens: Expo v2 four-choice by default, Expo v1 typed, or Kotlin AnswerEvent.
type answer struct {
	expoV1    bool
	kotlin    bool
	id        string
	learner   string // payload learner_id and source.local_profile_id
	install   string
	content   string // defaults: Expo v2 demo-synthetic-0.3; Expo v1 and Kotlin demo-synthetic-0.1
	track     string // Kotlin only; default arab
	item      string
	at        time.Time
	outcome   string // default correct
	notFresh  bool
	synthetic string // raw JSON value, default true; "-" omits it as Kotlin does for its default
	extra     string // raw payload members appended last, each starting with ','
}

func (a answer) envelope() []byte {
	if a.at.IsZero() {
		a.at = baseTime
	}
	if a.outcome == "" {
		a.outcome = "correct"
	}
	if a.synthetic == "" {
		a.synthetic = "true"
	}
	fresh := "true"
	if a.notFresh {
		fresh = "false"
	}
	date := a.at.UTC().Format(time.DateOnly)
	var schema, sv, family, track, rules, content, app, appVersion, payload string
	switch {
	case a.kotlin:
		schema, sv, family, app, appVersion = envelope.SchemaKotlinAnswer, "1", envelope.FamilyAndroid, "android", "0.1.0"
		track, rules, content = or(a.track, "arab"), "pilot-0.1", or(a.content, "demo-synthetic-0.1")
		synthetic := ""
		if a.synthetic != "-" {
			synthetic = `,"synthetic":` + a.synthetic
		}
		payload = `{"answer_id":"` + a.id + `","learner_id":"` + a.learner + `","item_id":"` + or(a.item, "DEMO-M01") +
			`","track":"` + track + `","content_version":"` + content + `","rules_version":"` + rules +
			`","app_version":"0.1.0","timestamp":"` + a.at.UTC().Format(time.RFC3339) + `","local_date":"` + date +
			`","session_id":"ses-it-k1","lang":"id","pool":"PRACT","unit":"A","skills":["LEX-A:W-A3"],` +
			`"raw_response":"{\"kind\":\"typed\",\"text\":\"orang yang jujur\"}","auto_score":{"meaning":"` + a.outcome +
			`"},"outcome":"` + a.outcome + `","first_attempt":true,"fresh_evidence":` + fresh +
			`,"time_on_item_ms":3100,"review_status":"draft"` + synthetic + `,"item_type":"type_in"` + a.extra + `}`
	case a.expoV1:
		schema, sv, family, app, appVersion = envelope.SchemaExpoAnswer, "1", envelope.FamilyExpo, "expo", "0.3.0"
		track, rules, content = "arab", "pilot-0.1-local", or(a.content, "demo-synthetic-0.1")
		payload = `{"answer_id":"` + a.id + `","learner_id":"` + a.learner + `","item_id":"` + or(a.item, "DEMO-P01") +
			`","content_version":"` + content + `","rules_version":"` + rules + `","app_version":"0.1.0","timestamp":"` +
			a.at.UTC().Format("2006-01-02T15:04:05.000Z") + `","local_date":"` + date +
			`","session_id":"ses-it-1","pool":"PRACT","unit":"A","skills":["NOM-01","LEX-P3"],` +
			`"raw_response":"{\"kind\":\"typed\",\"text\":\"  Dia BERIMAN!! \",\"ref\":\"perempuan\"}",` +
			`"auto_score":{"who":"` + a.outcome + `","description":"` + a.outcome + `","describes":"` + a.outcome +
			`"},"outcome":"` + a.outcome + `","error_tags":[],"serious_tag":null,"hint_used":false,"help_lines_shown":[],` +
			`"first_attempt":true,"fresh_evidence":` + fresh + `,"time_on_item_ms":4200,"audio_status":null,"report_flag":false,` +
			`"review_status":"draft","synthetic":` + a.synthetic + a.extra + `}`
	default:
		schema, sv, family, app, appVersion = envelope.SchemaExpoAnswer, "2", envelope.FamilyExpo, "expo", "0.3.0"
		track, rules, content = "arab", "pilot-0.3-local", or(a.content, "demo-synthetic-0.3")
		payload = `{"answer_id":"` + a.id + `","learner_id":"` + a.learner + `","item_id":"` + or(a.item, "A3-M01") +
			`","content_version":"` + content + `","rules_version":"` + rules + `","app_version":"0.3.0","timestamp":"` +
			a.at.UTC().Format("2006-01-02T15:04:05.000Z") + `","local_date":"` + date +
			`","session_id":"ses-it-2","pool":"PRACT","unit":"A","skills":["LEX-A:W-A3"],` +
			`"raw_response":"{\"kind\":\"choice\",\"option_id\":\"k\"}","auto_score":{"answer":"` + a.outcome +
			`"},"outcome":"` + a.outcome + `","error_tags":[],"serious_tag":null,"hint_used":false,"help_lines_shown":[],` +
			`"first_attempt":true,"fresh_evidence":` + fresh + `,"time_on_item_ms":5300,"audio_status":null,"report_flag":false,` +
			`"review_status":"draft","synthetic":` + a.synthetic + `,"answer_schema":2,"evidence_mode":"recognition-4",` +
			`"lineage":"A:word-form:` + sadiqun + `","role":"practice","presented_options":[{"id":"d2","text":"sahabat","position":0},` +
			`{"id":"d3","text":"orang yang sakit","position":1},{"id":"k","text":"orang yang jujur","position":2},` +
			`{"id":"d1","text":"orang yang bersedekah","position":3}],"selected_option_id":"k","selected_position":2,"misconceptions":[]` +
			a.extra + `}`
	}
	return []byte(`{"envelope_version":1,"event_id":"` + a.id + `","kind":"answer","schema":"` + schema + `","schema_version":` + sv +
		`,"curriculum":{"family":"` + family + `","track":"` + track + `","content_version":"` + content + `","rules_version":"` + rules +
		`"},"source":{"app":"` + app + `","install_id":"` + a.install + `","app_version":"` + appVersion + `","local_profile_id":"` + a.learner +
		`"},"payload":` + payload + `}`)
}

func or(v, fallback string) string {
	if v != "" {
		return v
	}
	return fallback
}

// payloadOf extracts the exact payload bytes of an envelope.
func payloadOf(t *testing.T, env []byte) []byte {
	t.Helper()
	var e struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(env, &e); err != nil || len(e.Payload) == 0 {
		t.Fatalf("envelope has no payload: %v", err)
	}
	return e.Payload
}

func batch(envs ...[]byte) []byte {
	return []byte(`{"events":[` + string(bytes.Join(envs, []byte(","))) + `]}`)
}

// newAdult is the only profile an import may create: settings and consent, nothing identifying.
const newAdult = `{"new_profile":{"kind":"adult","settings":{"instruction_lang":"id","session_minutes":10,"arabic_scale":1.25},"consent":{"version":"trial-consent-1","at":"2026-10-15T00:00:00Z"}}}`

func linkTo(pid string) string {
	return `{"profile_id":"` + pid + `"}`
}

// importBody is a guest import request; target is raw JSON (newAdult or linkTo).
func importBody(importID string, src sourceRef, target string, envs ...[]byte) []byte {
	return []byte(`{"import_id":"` + importID + `","source":{"app":"` + src.App + `","install_id":"` + src.InstallID +
		`","local_profile_id":"` + src.LocalProfileID + `"},"target":` + target + `,"events":[` + string(bytes.Join(envs, []byte(","))) + `]}`)
}

// eventIDsSHA256 is the receipt checksum: SHA-256 of the import's event IDs, sorted bytewise and joined
// by newlines, in lowercase hex.
func eventIDsSHA256(ids ...string) string {
	sorted := slices.Clone(ids)
	slices.Sort(sorted)
	sum := sha256.Sum256([]byte(strings.Join(sorted, "\n")))
	return hex.EncodeToString(sum[:])
}

func swap(t *testing.T, b []byte, old, repl string) []byte {
	t.Helper()
	if !bytes.Contains(b, []byte(old)) {
		t.Fatalf("test setup: %q not found", old)
	}
	return bytes.Replace(b, []byte(old), []byte(repl), 1)
}

// reformat re-encodes a JSON document with sorted members and indentation, keeping number literals: a
// different spelling of the same values.
func reformat(t *testing.T, b []byte) []byte {
	t.Helper()
	var v any
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("reformat: %v", err)
	}
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatalf("reformat: %v", err)
	}
	return out
}

// keysIn lists every object member name in a JSON document.
func keysIn(t *testing.T, b []byte) []string {
	t.Helper()
	var v any
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	var keys []string
	var walk func(any)
	walk = func(x any) {
		switch x := x.(type) {
		case map[string]any:
			for k, e := range x {
				keys = append(keys, k)
				walk(e)
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(v)
	return keys
}

func isRFC3339(s string) bool {
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}

func sameInstant(a, b string) bool {
	ta, errA := time.Parse(time.RFC3339Nano, a)
	tb, errB := time.Parse(time.RFC3339Nano, b)
	return errA == nil && errB == nil && ta.Equal(tb)
}

func val[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

func ptr[T any](v T) *T {
	return &v
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
