package server_test

// Local synthetic Supabase mode (AYA_MODE=local-supabase), Phase 4 RED. The service factory builds the FetchJWKS
// Supabase verifier against one explicitly configured loopback Auth and serves nothing until startup has fetched a
// usable key set from it. TestLocalSupabaseServiceStartsOnlyWithAuthsKeySet pins that against an owned plain-HTTP
// loopback stand-in; TestLocalSupabaseServiceAcceptsARealGoTruePasswordSession runs against the pinned real GoTrue
// v2.197.0 fixture that phase4_real_auth_fixture.py starts (AYA_REAL_AUTH_FIXTURE). Both use the isolated loopback
// PostgreSQL (AYA_TEST_DATABASE_URL) in fresh aya_t_ schemas that they drop. Missing infrastructure fails the tests;
// nothing is skipped. No token, password or credential is ever printed.

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
)

// localIssuer is the fixed synthetic issuer the stand-in signs with. It is configured explicitly, so it need not match
// the loopback base URL.
const localIssuer = "https://auth.ayailmu-local.test/auth/v1"

// testDatabase returns the isolated loopback PostgreSQL. It fails, never skips, when it is missing.
func testDatabase(t *testing.T) string {
	t.Helper()
	dbURL := os.Getenv("AYA_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("AYA_TEST_DATABASE_URL is not set: these tests need the isolated loopback PostgreSQL; refusing to skip")
	}
	return dbURL
}

// privateFile writes content to a new 0600 file in a test-owned directory and returns its absolute path.
func privateFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "admin-key")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// localSupabaseEnv is a complete local-supabase configuration for the Auth at authURL, signing as issuer.
func localSupabaseEnv(dbURL, schema, listen, authURL, issuer, adminKeyFile string) map[string]string {
	return map[string]string{
		config.EnvMode:                 config.ModeLocalSupabase,
		config.EnvListen:               listen,
		config.EnvDatabaseURL:          dbURL,
		config.EnvSchema:               schema,
		config.EnvSupabaseURL:          authURL,
		config.EnvSupabaseIssuer:       issuer,
		config.EnvSupabaseAudience:     "authenticated",
		config.EnvSupabaseAdminKeyFile: adminKeyFile,
	}
}

// loopbackListener reserves a loopback address for the service, so its Host allow-list matches real requests.
func loopbackListener(t *testing.T) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen on loopback: %v", err)
	}
	return ln
}

// closedLoopbackURL is a loopback base URL on which nothing listens.
func closedLoopbackURL(t *testing.T) string {
	t.Helper()
	ln := loopbackListener(t)
	addr := ln.Addr().String()
	ln.Close()
	return "http://" + addr
}

// serveOn serves svc on ln as a stack, so the shared call helpers apply; the test stops it before its schema is dropped.
func serveOn(t *testing.T, ln net.Listener, svc *server.Service, db *pgxpool.Pool) *stack {
	t.Helper()
	srv := httptest.NewUnstartedServer(svc.Handler())
	srv.Listener.Close()
	srv.Listener = ln
	srv.Start()
	s := &stack{svc: svc, srv: srv, host: ln.Addr().String(), base: "http://" + ln.Addr().String(), db: db}
	t.Cleanup(s.stop)
	return s
}

// onlyAccount returns the auth mode, issuer and subject of the test schema's account.
func (s *stack) onlyAccount(t *testing.T) (mode, issuer, subject string) {
	t.Helper()
	if err := s.db.QueryRow(context.Background(), `SELECT auth_mode, issuer, subject FROM accounts`).Scan(&mode, &issuer, &subject); err != nil {
		t.Fatalf("read the account: %v", err)
	}
	return mode, issuer, subject
}

// quiet renders err for a failure message, withholding text that quotes any of secrets.
func quiet(err error, secrets ...string) string {
	if err == nil {
		return "no error"
	}
	for _, s := range secrets {
		if s != "" && strings.Contains(err.Error(), s) {
			return "an error that quotes a secret (withheld)"
		}
	}
	return err.Error()
}

// syntheticUUID is a synthetic canonical UUID: lowercase, version 4.
func syntheticUUID(t *testing.T) string {
	t.Helper()
	h := randomHex(t, 16)
	return h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-a" + h[17:20] + "-" + h[20:]
}

// respond is an answer of status and exactly body.
func respond(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

// localAuth stands in for a local Supabase Auth on owned plain-HTTP loopback: GET /.well-known/jwks.json answers as the
// current case sets, by default with its one synthetic ES256 public key, and GET /user confirms its synthetic user.
// Every request is counted. A cookie or the admin credential on any request, or a credential on the key set request,
// is a fault.
type localAuth struct {
	srv   *httptest.Server
	key   *ecdsa.PrivateKey
	kid   string
	uid   string
	sid   string
	admin string
	valid http.HandlerFunc
	stop  chan struct{}

	mu     sync.Mutex
	keys   http.HandlerFunc
	calls  map[string]int
	faults []string
}

func newLocalAuth(t *testing.T) *localAuth {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	a := &localAuth{key: key, kid: "local-" + randomHex(t, 8), uid: syntheticUUID(t), sid: syntheticUUID(t),
		admin: "fake-admin-" + randomHex(t, 16), stop: make(chan struct{}), calls: map[string]int{}}
	a.valid = a.publish(t, jose.JSONWebKey{Key: &key.PublicKey, KeyID: a.kid, Algorithm: string(jose.ES256), Use: "sig"})
	a.keys = a.valid
	a.srv = httptest.NewServer(http.HandlerFunc(a.serve))
	t.Cleanup(a.srv.Close)
	t.Cleanup(func() { close(a.stop) }) // runs first, so no handler still waits when the server closes
	return a
}

// publish is a key set answer holding keys.
func (a *localAuth) publish(t *testing.T, keys ...jose.JSONWebKey) http.HandlerFunc {
	t.Helper()
	body, err := json.Marshal(jose.JSONWebKeySet{Keys: keys})
	if err != nil {
		t.Fatal(err)
	}
	return respond(http.StatusOK, string(body))
}

func (a *localAuth) serve(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	a.calls[r.Method+" "+r.URL.Path]++
	keys := a.keys
	a.mu.Unlock()
	if r.Header.Get("Cookie") != "" || strings.Contains(r.Header.Get("Authorization"), a.admin) {
		a.fault("a request to Auth carried a cookie or the admin credential")
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/.well-known/jwks.json":
		if r.Header.Get("Authorization") != "" || r.Header.Get("Apikey") != "" {
			a.fault("the key set request carried a credential")
		}
		keys(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/user":
		respond(http.StatusOK, `{"id":"`+a.uid+`","aud":"authenticated","role":"authenticated","is_anonymous":false}`)(w, r)
	case r.URL.Path == "/moved/.well-known/jwks.json":
		a.valid(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (a *localAuth) fault(what string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.faults = append(a.faults, what)
}

// answerKeys makes the key set endpoint answer with h from now on.
func (a *localAuth) answerKeys(h http.HandlerFunc) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.keys = h
}

// hang never answers: it waits until the caller gives up or the test ends.
func (a *localAuth) hang(_ http.ResponseWriter, r *http.Request) {
	select {
	case <-r.Context().Done():
	case <-a.stop:
	}
}

// served reports how often Auth served its key set and GET /user, and how many requests reached it in all. It fails
// the test on a fault.
func (a *localAuth) served(t *testing.T) (keys, users, total int) {
	t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.faults) > 0 {
		t.Fatalf("a request broke the service's side of Auth's contract: %q", a.faults)
	}
	for _, n := range a.calls {
		total += n
	}
	return a.calls["GET /.well-known/jwks.json"], a.calls["GET /user"], total
}

// token signs a password-session access token of the synthetic user with Auth's key, shaped as GoTrue v2.197.0 issues
// one.
func (a *localAuth) token(t *testing.T) string {
	t.Helper()
	now := time.Now().Unix()
	claims, err := json.Marshal(map[string]any{
		"iss": localIssuer, "aud": "authenticated", "sub": a.uid, "role": "authenticated", "exp": now + 3600, "iat": now - 30,
		"session_id": a.sid, "is_anonymous": false, "app_metadata": map[string]any{"provider": "email", "providers": []string{"email"}},
		"amr": []any{map[string]any{"method": "password", "timestamp": now - 30}},
	})
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: jose.JSONWebKey{Key: a.key, KeyID: a.kid}}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatalf("go-jose signer: %v", err)
	}
	signed, err := signer.Sign(claims)
	if err != nil {
		t.Fatalf("go-jose sign: %v", err)
	}
	token, err := signed.CompactSerialize()
	if err != nil {
		t.Fatalf("go-jose serialize: %v", err)
	}
	return token
}

// A local-supabase service fetches its Auth's key set at startup, before its schema exists, and refuses to start
// without a usable one: an error, malformed, empty, redirected or private-key answer, an Auth that does not answer in
// time and one that is not listening each refuse the service, wrapping authn.ErrKeySetUnavailable and quoting no
// credential, with no schema created and nothing asked of GET /user. With Auth's key set fetched once at startup, the
// service reports its mode, and a token of Auth's key reaches GET /v1/me without another fetch: one GET /user, and an
// account keyed by the local-supabase mode, the configured issuer and the token's subject. The admin credential never
// leaves the service, and the key set request carries no credential or cookie.
func TestLocalSupabaseServiceStartsOnlyWithAuthsKeySet(t *testing.T) {
	dbURL := testDatabase(t)
	probe := fixturePool(t, dbURL, "aya_t_probe")
	t.Cleanup(probe.Close)

	for _, c := range []struct {
		name string
		keys func(t *testing.T, a *localAuth) http.HandlerFunc
		down bool          // Auth does not listen at all
		wait time.Duration // the startup deadline when Auth does not answer
	}{
		{name: "Auth answers its key set with an error", keys: func(*testing.T, *localAuth) http.HandlerFunc {
			return respond(http.StatusInternalServerError, `{"code":500,"error_code":"unexpected_failure","msg":"unexpected failure"}`)
		}},
		{name: "Auth's key set is malformed", keys: func(*testing.T, *localAuth) http.HandlerFunc { return respond(http.StatusOK, `{"keys":[{"kty":"EC"`) }},
		{name: "Auth publishes no key", keys: func(*testing.T, *localAuth) http.HandlerFunc { return respond(http.StatusOK, `{"keys":[]}`) }},
		{name: "Auth redirects its key set", keys: func(*testing.T, *localAuth) http.HandlerFunc {
			return func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/moved/.well-known/jwks.json", http.StatusFound) }
		}},
		{name: "Auth publishes a private key", keys: func(t *testing.T, a *localAuth) http.HandlerFunc {
			return a.publish(t, jose.JSONWebKey{Key: a.key, KeyID: a.kid, Algorithm: string(jose.ES256), Use: "sig"})
		}},
		{name: "Auth does not answer in time", keys: func(_ *testing.T, a *localAuth) http.HandlerFunc { return a.hang }, wait: time.Second},
		{name: "Auth is not listening", down: true},
	} {
		t.Run("startup is refused when "+c.name, func(t *testing.T) {
			a := newLocalAuth(t)
			if c.keys != nil {
				a.answerKeys(c.keys(t, a))
			}
			authURL := a.srv.URL
			if c.down {
				authURL = closedLoopbackURL(t)
			}
			wait := c.wait
			if wait == 0 {
				wait = 10 * time.Second
			}
			ctx, cancel := context.WithTimeout(context.Background(), wait)
			defer cancel()
			schema := newSchemaName(t)
			start := time.Now()
			svc, err := server.New(ctx, lookupIn(localSupabaseEnv(dbURL, schema, "127.0.0.1:8091", authURL, localIssuer, privateFile(t, a.admin))), server.Options{})
			elapsed := time.Since(start)
			if svc != nil {
				svc.Close()
			}
			if schemaExists(t, probe, schema) {
				dropSchema(t, probe, schema)
				t.Error("a refused startup created its schema")
			}
			switch {
			case svc != nil || !errors.Is(err, authn.ErrKeySetUnavailable):
				t.Fatalf("server.New started without a usable key set (error %s)", quiet(err, a.admin))
			case strings.Contains(err.Error(), a.admin):
				t.Fatal("the refusal quotes the admin credential")
			case elapsed > wait+2*time.Second:
				t.Fatalf("startup took %v, well past its deadline", elapsed)
			}
			want := 1
			if c.down {
				want = 0
			}
			if keys, users, total := a.served(t); keys != want || users != 0 || total != keys {
				t.Fatalf("startup asked Auth's key set %d times, GET /user %d times and %d requests in all; want the key set %d times and nothing else",
					keys, users, total, want)
			}
		})
	}

	t.Run("Auth's key set fetched at startup verifies its tokens", func(t *testing.T) {
		a := newLocalAuth(t)
		schema := newSchemaName(t)
		db := fixturePool(t, dbURL, schema)
		t.Cleanup(func() {
			dropSchema(t, db, schema)
			db.Close()
		})
		ln := loopbackListener(t)
		svc, err := server.New(context.Background(), lookupIn(localSupabaseEnv(dbURL, schema, ln.Addr().String(), a.srv.URL, localIssuer, privateFile(t, a.admin))), server.Options{})
		if err != nil {
			ln.Close()
			t.Fatalf("server.New(local-supabase with Auth's key set published): %s", quiet(err, a.admin))
		}
		s := serveOn(t, ln, svc, db)
		if keys, users, _ := a.served(t); keys != 1 || users != 0 {
			t.Fatalf("startup asked Auth's key set %d times and GET /user %d times, want once and never", keys, users)
		}
		r := s.call(t, http.MethodGet, "/v1/healthz", "", nil)
		wantStatus(t, r, http.StatusOK)
		var h struct{ Status, Mode string }
		decodeJSON(t, r.body, &h)
		if h.Status != "ok" || h.Mode != config.ModeLocalSupabase {
			t.Fatalf("health = %+v, want ok/%s", h, config.ModeLocalSupabase)
		}
		r = s.call(t, http.MethodGet, "/v1/me", a.token(t), nil)
		wantStatus(t, r, http.StatusOK)
		var got me
		decodeJSON(t, r.body, &got)
		if !uuidRE.MatchString(got.AccountID) || len(got.Profiles) != 0 {
			t.Fatalf("GET /v1/me = %+v, want a new account without profiles", got)
		}
		if keys, users, _ := a.served(t); keys != 1 || users != 1 {
			t.Fatalf("a token of the startup key set asked Auth's key set %d times in all and GET /user %d times, want once each", keys, users)
		}
		if mode, issuer, subject := s.onlyAccount(t); mode != config.ModeLocalSupabase || issuer != localIssuer || subject != a.uid {
			t.Fatalf("the account is keyed %q/%q/%q, want the local-supabase mode, the configured issuer and the token's subject", mode, issuer, subject)
		}
	})
}

// realAuth is the real GoTrue fixture as its fixture.env describes it: Auth's loopback base URL, the issuer and
// audience it signs with, the private admin credential file, its synthetic user's ID, email and password, and three
// tokens the fixture signed with Auth's own key through jose-util, each differing from a real access token of that
// user only in its issuer, audience or role.
type realAuth struct {
	url           string
	issuer        string
	audience      string
	adminKeyFile  string
	userID        string
	email         string
	password      string
	wrongIssuer   string
	wrongAudience string
	wrongRole     string
}

// realAuthFixture reads the fixture.env that AYA_REAL_AUTH_FIXTURE names. A missing, unsafe or incomplete fixture
// fails the test; nothing is skipped and nothing read is printed.
func realAuthFixture(t *testing.T) realAuth {
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
	required := []string{config.EnvSupabaseURL, config.EnvSupabaseIssuer, config.EnvSupabaseAudience, config.EnvSupabaseAdminKeyFile,
		"AYA_FIXTURE_USER_ID", "AYA_FIXTURE_USER_EMAIL", "AYA_FIXTURE_USER_PASSWORD", "AYA_FIXTURE_TOKEN_WRONG_ISSUER",
		"AYA_FIXTURE_TOKEN_WRONG_AUDIENCE", "AYA_FIXTURE_TOKEN_WRONG_ROLE"}
	for _, name := range required {
		if values[name] == "" {
			t.Fatalf("the real GoTrue fixture file does not set %s", name)
		}
	}
	return realAuth{url: values[config.EnvSupabaseURL], issuer: values[config.EnvSupabaseIssuer], audience: values[config.EnvSupabaseAudience],
		adminKeyFile: values[config.EnvSupabaseAdminKeyFile], userID: values["AYA_FIXTURE_USER_ID"], email: values["AYA_FIXTURE_USER_EMAIL"],
		password: values["AYA_FIXTURE_USER_PASSWORD"], wrongIssuer: values["AYA_FIXTURE_TOKEN_WRONG_ISSUER"],
		wrongAudience: values["AYA_FIXTURE_TOKEN_WRONG_AUDIENCE"], wrongRole: values["AYA_FIXTURE_TOKEN_WRONG_ROLE"]}
}

// signIn signs the fixture's synthetic user in with its password at the real Auth's POST /token, as the app will: a
// real password-session access token, fresh for this test.
func (fx realAuth) signIn(t *testing.T) string {
	t.Helper()
	body, err := json.Marshal(map[string]string{"email": fx.email, "password": fx.password})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, fx.url+"/token?grant_type=password", bytes.NewReader(body))
	if err != nil {
		t.Fatal("the real GoTrue fixture's base URL is unusable")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("the real GoTrue fixture did not answer the password sign-in: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out) != nil || strings.Count(out.AccessToken, ".") != 2 {
		t.Fatalf("the real GoTrue fixture answered the password sign-in with status %d and no access token", resp.StatusCode)
	}
	return out.AccessToken
}

// Against the pinned real GoTrue v2.197.0 fixture, a local-supabase service built by the factory fetches Auth's
// published key set at startup, and a password session the test signs in to reaches GET /v1/me as the fixture's
// synthetic user; a second request finds the same account, keyed by the local-supabase mode, the fixture's issuer and
// its user's ID. Tokens signed with Auth's own key but naming another issuer, another audience or the service_role are
// the same uniform 401 as no token at all, and create no account.
func TestLocalSupabaseServiceAcceptsARealGoTruePasswordSession(t *testing.T) {
	fx := realAuthFixture(t)
	dbURL := testDatabase(t)
	token := fx.signIn(t)
	secrets := []string{token, fx.password, fx.wrongIssuer, fx.wrongAudience, fx.wrongRole}

	schema := newSchemaName(t)
	db := fixturePool(t, dbURL, schema)
	t.Cleanup(func() {
		dropSchema(t, db, schema)
		db.Close()
	})
	ln := loopbackListener(t)
	env := localSupabaseEnv(dbURL, schema, ln.Addr().String(), fx.url, fx.issuer, fx.adminKeyFile)
	env[config.EnvSupabaseAudience] = fx.audience
	svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
	if err != nil {
		ln.Close()
		t.Fatalf("server.New(local-supabase against the real GoTrue fixture): %s", quiet(err, secrets...))
	}
	s := serveOn(t, ln, svc, db)

	r := s.call(t, http.MethodGet, "/v1/healthz", "", nil)
	wantStatus(t, r, http.StatusOK)
	var h struct{ Status, Mode string }
	decodeJSON(t, r.body, &h)
	if h.Status != "ok" || h.Mode != config.ModeLocalSupabase {
		t.Fatalf("health = %+v, want ok/%s", h, config.ModeLocalSupabase)
	}

	r = s.call(t, http.MethodGet, "/v1/me", token, nil)
	wantStatus(t, r, http.StatusOK)
	var first me
	decodeJSON(t, r.body, &first)
	if !uuidRE.MatchString(first.AccountID) || len(first.Profiles) != 0 {
		t.Fatalf("GET /v1/me = %+v, want a new account without profiles", first)
	}
	r = s.call(t, http.MethodGet, "/v1/me", token, nil)
	wantStatus(t, r, http.StatusOK)
	var again me
	decodeJSON(t, r.body, &again)
	if again.AccountID != first.AccountID {
		t.Fatal("a second request of the same session found another account")
	}
	if mode, issuer, subject := s.onlyAccount(t); mode != config.ModeLocalSupabase || issuer != fx.issuer || subject != fx.userID {
		t.Fatalf("the account is keyed %q/%q/%q, want the local-supabase mode, the fixture's issuer and its user's ID", mode, issuer, subject)
	}

	none := s.call(t, http.MethodGet, "/v1/me", "", nil)
	wantProblem(t, none, http.StatusUnauthorized, "unauthenticated")
	for _, c := range []struct{ name, token string }{
		{"another issuer", fx.wrongIssuer},
		{"another audience", fx.wrongAudience},
		{"the service_role", fx.wrongRole},
	} {
		r := s.call(t, http.MethodGet, "/v1/me", c.token, nil)
		wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
		if !bytes.Equal(r.body, none.body) {
			t.Fatalf("a token signed with Auth's key but naming %s gets another 401 than no token", c.name)
		}
	}
	if n := s.count(t, "SELECT count(*) FROM accounts"); n != 1 {
		t.Fatalf("refused tokens left %d accounts, want only the signed-in user's", n)
	}
}
