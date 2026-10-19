package server_test

// Real GoTrue security flows, Phase 5 RED. Against the pinned real GoTrue v2.197.0 fixture (AYA_REAL_AUTH_FIXTURE),
// each test creates its own random example.test ordinary users through Auth's documented admin API, with the
// fixture's server-only credential read from its private file only while the test runs, and deletes them when it ends.
// The fixture's own seed user is never used or touched. Every token is one the real Auth issued for a password sign-in
// or a refresh: nothing is re-signed or edited, and the tests only read claims to know a session and its password
// sign-in time. The service runs in local-supabase mode on a fresh aya_t_ schema of the isolated loopback PostgreSQL
// (AYA_TEST_DATABASE_URL). No token, password, credential, DSN or answer body of Auth is ever printed.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
)

// authUser is one owned synthetic user of the real Auth.
type authUser struct{ id, email, password string }

// authSession is one real session of the real Auth: its access and refresh tokens.
type authSession struct{ access, refresh string }

// realProvider is the real Auth as its owned clients use it: the admin API with the fixture's server-only credential,
// and the user endpoints an app calls.
type realProvider struct {
	url   string
	admin string
}

func newRealProvider(t *testing.T, fx realAuth) *realProvider {
	t.Helper()
	key, err := os.ReadFile(fx.adminKeyFile)
	if err != nil || len(key) == 0 {
		t.Fatal("the real GoTrue fixture's admin credential file cannot be read")
	}
	return &realProvider{url: fx.url, admin: strings.TrimSuffix(string(key), "\n")}
}

// call sends one request to the real Auth and returns its status and body, of at most 1 MiB; neither is printed.
func (p *realProvider) call(t *testing.T, method, path, bearer string, body any) (int, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, p.url+path, rd)
	if err != nil {
		t.Fatal("the real GoTrue fixture's base URL is unusable")
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("the real GoTrue fixture did not answer %s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		t.Fatalf("the real GoTrue fixture's answer to %s %s was cut short", method, path)
	}
	return resp.StatusCode, raw
}

// createUser creates one owned ordinary user, confirmed, through the documented admin API, and deletes it when the
// test ends unless the test deleted it already. Signup stays disabled.
func (p *realProvider) createUser(t *testing.T) authUser {
	t.Helper()
	u := authUser{email: "aya-it-" + randomHex(t, 8) + "@example.test", password: "pw-" + randomHex(t, 16)}
	status, raw := p.call(t, http.MethodPost, "/admin/users", p.admin,
		map[string]any{"email": u.email, "password": u.password, "email_confirm": true, "role": "authenticated"})
	var created struct {
		ID string `json:"id"`
	}
	if status != http.StatusOK || json.Unmarshal(raw, &created) != nil || !uuidRE.MatchString(created.ID) {
		t.Fatalf("the real Auth did not create an owned synthetic user (status %d)", status)
	}
	u.id = created.ID
	t.Cleanup(func() { p.removeUser(t, u.id) })
	return u
}

// removeUser hard-deletes one owned user through the admin API; one already gone is fine. A failure is reported by
// status only.
func (p *realProvider) removeUser(t *testing.T, id string) {
	t.Helper()
	status, _ := p.call(t, http.MethodDelete, "/admin/users/"+id, p.admin, map[string]bool{"should_soft_delete": false})
	if status != http.StatusOK && status != http.StatusNotFound {
		t.Errorf("cleanup: the real Auth answered %d to deleting an owned synthetic user", status)
	}
}

// exists reports whether the real Auth still has the user, through the admin API: 200 with its ID, or the precise 404
// user_not_found. Anything else fails the test.
func (p *realProvider) exists(t *testing.T, id string) bool {
	t.Helper()
	status, raw := p.call(t, http.MethodGet, "/admin/users/"+id, p.admin, nil)
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

// signIn signs u in with its password at the real Auth's POST /token, as the app will.
func (p *realProvider) signIn(t *testing.T, u authUser) authSession {
	t.Helper()
	s, status := p.trySignIn(t, u)
	if status != http.StatusOK {
		t.Fatalf("the real Auth refused an owned user's password sign-in (status %d)", status)
	}
	return s
}

func (p *realProvider) trySignIn(t *testing.T, u authUser) (authSession, int) {
	t.Helper()
	return p.grant(t, "password", map[string]string{"email": u.email, "password": u.password})
}

// refresh exchanges a refresh token at the real Auth's POST /token, as the app will. A refresh token is never sent
// twice: Auth rotates it.
func (p *realProvider) refresh(t *testing.T, refreshToken string) (authSession, int) {
	t.Helper()
	return p.grant(t, "refresh_token", map[string]string{"refresh_token": refreshToken})
}

func (p *realProvider) grant(t *testing.T, grantType string, body map[string]string) (authSession, int) {
	t.Helper()
	status, raw := p.call(t, http.MethodPost, "/token?grant_type="+grantType, "", body)
	if status != http.StatusOK {
		return authSession{}, status
	}
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if json.Unmarshal(raw, &out) != nil || strings.Count(out.AccessToken, ".") != 2 || out.RefreshToken == "" {
		t.Fatalf("the real Auth's %s grant answered 200 without a session", grantType)
	}
	return authSession{access: out.AccessToken, refresh: out.RefreshToken}, status
}

// logout ends sessions at the real Auth's POST /logout with an access token of one: scope "local" ends that session,
// "global" every session of its user. It returns Auth's status.
func (p *realProvider) logout(t *testing.T, access, scope string) int {
	t.Helper()
	status, _ := p.call(t, http.MethodPost, "/logout?scope="+scope, access, nil)
	return status
}

// ban sets the user's ban through the admin API: a duration such as "1h", or "none" to lift it.
func (p *realProvider) ban(t *testing.T, id, duration string) {
	t.Helper()
	if status, _ := p.call(t, http.MethodPut, "/admin/users/"+id, p.admin, map[string]string{"ban_duration": duration}); status != http.StatusOK {
		t.Fatalf("the real Auth answered %d to setting an owned user's ban to %s", status, duration)
	}
}

// waitUntil polls the real Auth's own clock, the Date of its health answer, until it reads at least at. It waits a
// few seconds at most.
func (p *realProvider) waitUntil(t *testing.T, at time.Time) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		resp, err := httpClient.Get(p.url + "/health")
		if err != nil {
			t.Fatalf("the real GoTrue fixture did not answer its health check: %v", err)
		}
		resp.Body.Close()
		date, err := http.ParseTime(resp.Header.Get("Date"))
		switch {
		case err != nil:
			t.Fatal("the real Auth's health answer has no usable Date")
		case !date.Before(at):
			return
		case time.Now().After(deadline):
			t.Fatal("the real Auth's clock did not reach the awaited instant in time")
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// issued is what a test reads, without verifying, of a token the real Auth just issued to it: whose it is, which
// session, and when that session's user last proved their password.
type issued struct {
	Subject   string `json:"sub"`
	SessionID string `json:"session_id"`
	AMR       []struct {
		Method    string `json:"method"`
		Timestamp int64  `json:"timestamp"`
	} `json:"amr"`
}

func claimsOf(t *testing.T, token string) issued {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatal("the real Auth issued a token that is not a compact JWS")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	var c issued
	if err != nil || json.Unmarshal(raw, &c) != nil {
		t.Fatal("the real Auth issued a token whose claims do not decode")
	}
	return c
}

// passwordAt is the session's password sign-in time, from its amr, in Unix seconds; zero when there is none.
func (c issued) passwordAt() int64 {
	for _, m := range c.AMR {
		if m.Method == "password" {
			return m.Timestamp
		}
	}
	return 0
}

// serviceClock is the service's clock in the recent sign-in test: the real time until the test sets an instant, then
// that instant. The real Auth keeps its own clock, and no window, token or OS clock changes.
type serviceClock struct {
	mu sync.Mutex
	at time.Time
}

func (c *serviceClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.at.IsZero() {
		return time.Now()
	}
	return c.at
}

func (c *serviceClock) set(at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.at = at
}

// newRealStack serves a local-supabase service against the real fixture on a fresh schema, with adminKeyFile as its
// admin credential file: the fixture's own, or a test's private one.
func newRealStack(t *testing.T, fx realAuth, adminKeyFile string, opts server.Options) *stack {
	t.Helper()
	s := &stack{dbURL: testDatabase(t), schema: newSchemaName(t), opts: opts}
	s.db = fixturePool(t, s.dbURL, s.schema)
	t.Cleanup(func() {
		dropSchema(t, s.db, s.schema)
		s.db.Close()
	})
	t.Cleanup(s.stop)
	s.startReal(t, fx, adminKeyFile)
	return s
}

// startReal starts the stack's local-supabase service on its schema, as on a restart: the data stays.
func (s *stack) startReal(t *testing.T, fx realAuth, adminKeyFile string) {
	t.Helper()
	ln := loopbackListener(t)
	env := localSupabaseEnv(s.dbURL, s.schema, ln.Addr().String(), fx.url, fx.issuer, adminKeyFile)
	env[config.EnvSupabaseAudience] = fx.audience
	svc, err := server.New(context.Background(), lookupIn(env), s.opts)
	if err != nil {
		ln.Close()
		t.Fatalf("server.New(local-supabase against the real GoTrue fixture): %s", quiet(err))
	}
	srv := httptest.NewUnstartedServer(svc.Handler())
	srv.Listener.Close()
	srv.Listener = ln
	srv.Start()
	s.svc, s.srv, s.host, s.base = svc, srv, ln.Addr().String(), "http://"+ln.Addr().String()
}

// wantSameUnauthenticated checks that token gets exactly the uniform 401 of a request without one.
func wantSameUnauthenticated(t *testing.T, s *stack, token string, uniform reply, what string) {
	t.Helper()
	r := s.call(t, http.MethodGet, "/v1/me", token, nil)
	wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
	if !bytes.Equal(r.body, uniform.body) {
		t.Fatalf("%s: the 401 differs from the uniform one", what)
	}
}

// exportOf reads the account export of token: 200, JSON, with a Content-Length that is the body's.
func exportOf(t *testing.T, s *stack, token string) (exportDoc, reply) {
	t.Helper()
	r := s.call(t, http.MethodGet, exportPath, token, nil)
	wantStatus(t, r, http.StatusOK)
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	if cl := r.header.Get("Content-Length"); cl != strconv.Itoa(len(r.body)) {
		t.Fatalf("Content-Length = %q for a body of %d bytes", cl, len(r.body))
	}
	var x exportDoc
	decodeJSON(t, r.body, &x)
	return x, r
}

// exportMember is one object member of an export: its name, and the member names and array indexes that lead to the
// object holding it.
type exportMember struct {
	name string
	path []any
}

// exportMembers lists every object member of an export, as keysIn does, each with its path.
func exportMembers(t *testing.T, b []byte) []exportMember {
	t.Helper()
	var v any
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	var members []exportMember
	var walk func(x any, path []any)
	walk = func(x any, path []any) {
		switch x := x.(type) {
		case map[string]any:
			for k, e := range x {
				members = append(members, exportMember{name: k, path: path})
				walk(e, append(slices.Clip(path), k))
			}
		case []any:
			for i, e := range x {
				walk(e, append(slices.Clip(path), i))
			}
		}
	}
	walk(v, nil)
	return members
}

// inEventPayload reports whether the member is a top-level member of an exported event's payload,
// profiles[i].events[j].payload: the learning record as its client sent it.
func (m exportMember) inEventPayload() bool {
	if len(m.path) != 5 {
		return false
	}
	_, profile := m.path[1].(int)
	_, event := m.path[3].(int)
	return m.path[0] == "profiles" && profile && m.path[2] == "events" && event && m.path[4] == "payload"
}

// Sessions stay live only while the real Auth keeps them. A password session reaches the API as its user; its refresh
// is the same user and session with the same password sign-in time; two sessions of one identity are one account,
// another user's another. A local logout ends that session at once, its unexpired access token and its refresh token
// both, while the user's other session and another user stay live; a global logout ends every session of the user and
// nobody else's. A ban refuses the user's live session and its sign-ins while another user stays live, and lifting it
// lets the user sign in again. Every refusal is the uniform 401.
func TestRealGoTrueSessionsStayLiveOnlyWhileAuthKeepsThem(t *testing.T) {
	fx := realAuthFixture(t)
	p := newRealProvider(t, fx)
	s := newRealStack(t, fx, fx.adminKeyFile, server.Options{})
	uniform := s.call(t, http.MethodGet, "/v1/me", "", nil)
	wantProblem(t, uniform, http.StatusUnauthorized, "unauthenticated")
	u, other := p.createUser(t), p.createUser(t)
	theirs := p.signIn(t, other)
	otherAccount := s.accountOf(t, theirs.access)
	first := p.signIn(t, u)
	account := s.accountOf(t, first.access)
	if c := claimsOf(t, first.access); c.Subject != u.id || !uuidRE.MatchString(c.SessionID) || c.passwordAt() == 0 || account == otherAccount {
		t.Fatal("a password session is not its own user's, with a session and a password sign-in time, in its own account")
	}
	step := func(name string, f func(t *testing.T)) {
		if !t.Run(name, f) {
			t.FailNow()
		}
	}
	var second authSession

	step("a refresh is the same user and session with the same password sign-in time", func(t *testing.T) {
		refreshed, status := p.refresh(t, first.refresh)
		if status != http.StatusOK {
			t.Fatalf("the real Auth refused a live session's refresh (status %d)", status)
		}
		was, now := claimsOf(t, first.access), claimsOf(t, refreshed.access)
		if now.Subject != was.Subject || now.SessionID != was.SessionID || now.passwordAt() != was.passwordAt() {
			t.Fatal("the refresh changed the user, the session or the password sign-in time")
		}
		if s.accountOf(t, refreshed.access) != account {
			t.Fatal("the refreshed session reaches another account")
		}
		first = refreshed
	})

	step("two sessions of one identity are one account; another user is another", func(t *testing.T) {
		second = p.signIn(t, u)
		if claimsOf(t, second.access).SessionID == claimsOf(t, first.access).SessionID {
			t.Fatal("a second password sign-in reused the first session")
		}
		if s.accountOf(t, second.access) != account || s.accountOf(t, first.access) != account {
			t.Fatal("two live sessions of one identity reach different accounts")
		}
		if s.accountOf(t, theirs.access) != otherAccount {
			t.Fatal("another user's session reaches another account than its own")
		}
	})

	step("a local logout ends that session, access and refresh token, and nothing else", func(t *testing.T) {
		if status := p.logout(t, first.access, "local"); status != http.StatusNoContent {
			t.Fatalf("the real Auth answered %d to a local logout", status)
		}
		wantSameUnauthenticated(t, s, first.access, uniform, "the logged-out session's unexpired access token")
		if _, status := p.refresh(t, first.refresh); status == http.StatusOK {
			t.Fatal("the logged-out session's refresh token still refreshes")
		}
		if s.accountOf(t, second.access) != account {
			t.Fatal("the user's other session reaches another account")
		}
		refreshed, status := p.refresh(t, second.refresh)
		if status != http.StatusOK {
			t.Fatalf("the user's other session no longer refreshes (status %d)", status)
		}
		second = refreshed
		if s.accountOf(t, theirs.access) != otherAccount {
			t.Fatal("another user's session reaches another account than its own")
		}
	})

	step("a global logout ends every session of the user and nobody else's", func(t *testing.T) {
		third := p.signIn(t, u)
		if status := p.logout(t, second.access, "global"); status != http.StatusNoContent {
			t.Fatalf("the real Auth answered %d to a global logout", status)
		}
		for _, c := range []struct {
			what    string
			session authSession
		}{{"the session that logged out", second}, {"another session of the same user", third}} {
			wantSameUnauthenticated(t, s, c.session.access, uniform, c.what)
			if _, status := p.refresh(t, c.session.refresh); status == http.StatusOK {
				t.Fatalf("%s still refreshes after the global logout", c.what)
			}
		}
		if s.accountOf(t, theirs.access) != otherAccount {
			t.Fatal("another user's session did not outlive the global logout")
		}
	})

	step("a ban refuses the user's live session and sign-ins, never another user; lifting it restores sign-in", func(t *testing.T) {
		live := p.signIn(t, u)
		if s.accountOf(t, live.access) != account {
			t.Fatal("a new password session after the logout reaches another account")
		}
		p.ban(t, u.id, "1h")
		wantSameUnauthenticated(t, s, live.access, uniform, "a banned user's live session")
		if _, status := p.trySignIn(t, u); status == http.StatusOK {
			t.Fatal("a banned user signed in")
		}
		if s.accountOf(t, theirs.access) != otherAccount {
			t.Fatal("another user's session did not outlive the ban")
		}
		p.ban(t, u.id, "none")
		if s.accountOf(t, p.signIn(t, u).access) != account {
			t.Fatal("after the ban was lifted, a new password session reaches another account")
		}
	})
}

// The recent sign-in the export needs is the real Auth's password sign-in, and a refresh never renews it. The service
// clock stands 301 seconds after a real session's password sign-in, its tokens still unexpired. That session is then
// too old for the export, which answers the RFC 9470 step-up challenge, not the uniform 401, while GET /v1/me still
// serves it; its refresh by the real Auth stays as old. A new password sign-in of the same identity, at least 2 seconds
// later by Auth's clock, makes the export work at that same instant, and the old tokens stay too old. The export is
// exactly the account's server data, with no credential and nothing of another account, and reading it changes
// nothing; another user reaches none of it. Only the service's own clock is set: no window, token or OS clock changes.
func TestRealGoTrueRecentSignInIsAPasswordSignInThatRefreshNeverRenews(t *testing.T) {
	fx := realAuthFixture(t)
	p := newRealProvider(t, fx)
	clock := &serviceClock{}
	s := newRealStack(t, fx, fx.adminKeyFile, server.Options{Now: clock.Now})
	u, other := p.createUser(t), p.createUser(t)
	old := p.signIn(t, u)
	t0 := claimsOf(t, old.access).passwordAt()
	if t0 == 0 {
		t.Fatal("the real Auth's password session carries no password sign-in time")
	}

	// Server data of both accounts, from the same device identifiers, import ID and first event ID: only the account
	// tells them apart.
	src := sourceRef{App: "expo", InstallID: "inst-rs-1", LocalProfileID: "lrn-rs-1"}
	ev := func(n int, outcome string) []byte {
		return answer{id: fmt.Sprintf("ans-rs-%d", n), learner: src.LocalProfileID, install: src.InstallID, outcome: outcome,
			at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	r := s.call(t, http.MethodPost, "/v1/imports", old.access, importBody("imp-rs-1", src, newAdult, ev(1, "correct"), ev(2, "correct")))
	wantStatus(t, r, http.StatusCreated)
	var mine receipt
	decodeJSON(t, r.body, &mine)
	if up := s.upload(t, old.access, mine.ProfileID, ev(3, "correct")); up.Results[0].Status != http.StatusCreated {
		t.Fatalf("upload = %+v", up.Results[0])
	}
	theirs := p.signIn(t, other)
	r = s.call(t, http.MethodPost, "/v1/imports", theirs.access, importBody("imp-rs-1", src, newAdult, ev(1, "wrong")))
	wantStatus(t, r, http.StatusCreated)
	var their receipt
	decodeJSON(t, r.body, &their)
	account := s.accountOf(t, old.access)

	clock.set(time.Unix(t0, 0).Add(301 * time.Second))
	tooOld := func(t *testing.T, token, what string) {
		t.Helper()
		r := s.call(t, http.MethodGet, exportPath, token, nil)
		wantProblem(t, r, http.StatusUnauthorized, "reauthentication_required")
		if c := r.header.Get("WWW-Authenticate"); !strings.Contains(c, `error="insufficient_user_authentication"`) || !strings.Contains(c, "max_age=300") {
			t.Fatalf("%s: WWW-Authenticate = %q, want the RFC 9470 step-up challenge with max_age=300", what, c)
		}
		if s.accountOf(t, token) != account {
			t.Fatalf("%s: GET /v1/me no longer serves the session's own account", what)
		}
	}
	step := func(name string, f func(t *testing.T)) {
		if !t.Run(name, f) {
			t.FailNow()
		}
	}
	var refreshed, again authSession

	step("301 seconds after its password sign-in a live session is too old for the export, yet still signed in", func(t *testing.T) {
		tooOld(t, old.access, "the password session")
	})

	step("a refresh by the real Auth keeps the old password sign-in", func(t *testing.T) {
		var status int
		if refreshed, status = p.refresh(t, old.refresh); status != http.StatusOK {
			t.Fatalf("the real Auth refused a live session's refresh (status %d)", status)
		}
		if c := claimsOf(t, refreshed.access); c.passwordAt() != t0 || c.SessionID != claimsOf(t, old.access).SessionID {
			t.Fatal("the real Auth's refresh changed the session or its password sign-in time")
		}
		tooOld(t, refreshed.access, "the refreshed session")
	})

	step("a new password sign-in of the same identity is recent at the same instant; the old session stays too old", func(t *testing.T) {
		p.waitUntil(t, time.Unix(t0+2, 0))
		again = p.signIn(t, u)
		if at := claimsOf(t, again.access).passwordAt(); at < t0+2 {
			t.Fatalf("the new password sign-in is %d seconds after the first, want at least 2", at-t0)
		}
		before := s.count(t, `SELECT (SELECT count(*) FROM profiles) + (SELECT count(*) FROM profile_sources) + (SELECT count(*) FROM imports) +
			(SELECT count(*) FROM events) + (SELECT coalesce(sum(revision + high_seq), 0)::bigint FROM profiles)`)
		x, raw := exportOf(t, s, again.access)
		var mode struct {
			Account struct {
				AuthMode string `json:"auth_mode"`
			} `json:"account"`
		}
		decodeJSON(t, raw.body, &mode)
		if x.Format != "ayailmu-server-export-1" || x.Account.AccountID != account || x.Account.Issuer != fx.issuer ||
			x.Account.Subject != u.id || mode.Account.AuthMode != config.ModeLocalSupabase {
			t.Fatalf("export account = %+v (mode %q), want account %s of the fixture's issuer, the user's subject and local-supabase",
				x.Account, mode.Account.AuthMode, account)
		}
		if len(x.Profiles) != 1 || x.Profiles[0].ProfileID != mine.ProfileID || len(x.Profiles[0].Events) != 3 ||
			len(x.Profiles[0].Imports) != 1 || x.Profiles[0].Imports[0].Receipt != mine {
			t.Fatalf("the export holds %d profiles, want exactly the account's one with its 3 events and its import", len(x.Profiles))
		}
		for i, e := range x.Profiles[0].Events {
			if !bytes.Equal(e.Payload, payloadOf(t, ev(i+1, "correct"))) {
				t.Fatalf("event %d: the exported payload is not the original's exact bytes", i+1)
			}
		}
		var what []string
		for _, n := range x.Contents.NotIncluded {
			what = append(what, n.What)
		}
		slices.Sort(what)
		if !slices.Equal(what, []string{"credentials", "device_data", "identity_provider_account"}) {
			t.Fatalf("not_included names %v, want exactly credentials, device_data and identity_provider_account", what)
		}
		for _, c := range []struct{ what, value string }{
			{"an access token", old.access}, {"a refresh token", old.refresh}, {"a refreshed access token", refreshed.access},
			{"a refreshed refresh token", refreshed.refresh}, {"the new access token", again.access}, {"the new refresh token", again.refresh},
			{"the old session's ID", claimsOf(t, old.access).SessionID}, {"the refreshed session's ID", claimsOf(t, refreshed.access).SessionID},
			{"the new session's ID", claimsOf(t, again.access).SessionID}, {"the other user's session ID", claimsOf(t, theirs.access).SessionID},
			{"the password", u.password}, {"the sign-in address", u.email},
			{"the admin credential", p.admin}, {"the other user's subject", other.id}, {"the other user's address", other.email},
			{"the other account's profile", their.ProfileID},
		} {
			if bytes.Contains(raw.body, []byte(c.value)) {
				t.Fatalf("the export contains %s", c.what)
			}
		}
		if bytes.Contains(raw.body, payloadOf(t, ev(1, "wrong"))) {
			t.Fatal("the export contains the other account's record under the same event ID")
		}
		// The learning records carry a session_id member of their own, which the export keeps in each event's payload
		// with the exact bytes compared above: only there may one appear.
		for _, m := range exportMembers(t, raw.body) {
			switch strings.ToLower(m.name) {
			case "password", "token", "access_token", "refresh_token", "authorization", "email", "api_key", "apikey",
				"secret", "credential", "credentials", "private_key":
				t.Fatalf("the export carries a %q member", m.name)
			case "session_id":
				if !m.inEventPayload() {
					t.Fatalf("the export carries a %q member outside an event's payload, at %v", m.name, m.path)
				}
			}
		}
		if after := s.count(t, `SELECT (SELECT count(*) FROM profiles) + (SELECT count(*) FROM profile_sources) + (SELECT count(*) FROM imports) +
			(SELECT count(*) FROM events) + (SELECT coalesce(sum(revision + high_seq), 0)::bigint FROM profiles)`); after != before {
			t.Fatal("reading the export changed the stored data")
		}
		tooOld(t, refreshed.access, "the refreshed old session")
		tooOld(t, old.access, "the old session")
	})

	step("another user reaches none of it", func(t *testing.T) {
		recent := p.signIn(t, other)
		for _, path := range []string{"/v1/profiles/" + mine.ProfileID, "/v1/profiles/" + mine.ProfileID + "/events?after=0"} {
			wantProblem(t, s.call(t, http.MethodGet, path, recent.access, nil), http.StatusNotFound, "not_found")
		}
		x, raw := exportOf(t, s, recent.access)
		if x.Account.Subject != other.id || len(x.Profiles) != 1 || x.Profiles[0].ProfileID != their.ProfileID ||
			bytes.Contains(raw.body, []byte(mine.ProfileID)) || bytes.Contains(raw.body, []byte(u.id)) {
			t.Fatal("the other user's export is not exactly its own account's")
		}
	})
}

// Deleting an account erases its server data first, atomically, then deletes the real Auth's user with the service's
// server-only credential. With a wrong synthetic credential the real Auth refuses that deletion: the answer is 202 with
// the identity step pending, Auth still has the user, and the account answers 410 everywhere but its deletion's own
// route. After a restart on the same database with the right credential, a new password sign-in of the same user
// completes the same deletion: 200, the same deletion ID. Auth then no longer has the user, so the old access tokens,
// the refresh token and a password sign-in all fail, another user stays live, and the erased data stays erased with
// nothing re-creating the account. (When Auth deletes a user but its answer is lost, the user cannot retry, the
// identity being gone: that case is left to operator reconciliation, and no background retry exists.)
func TestRealGoTrueDeletionErasesFirstThenDeletesTheUserWithTheServerCredential(t *testing.T) {
	fx := realAuthFixture(t)
	p := newRealProvider(t, fx)
	wrongKey := "aya-synthetic-wrong-admin-" + randomHex(t, 16)
	s := newRealStack(t, fx, privateFile(t, wrongKey), server.Options{})
	uniform := s.call(t, http.MethodGet, "/v1/me", "", nil)
	wantProblem(t, uniform, http.StatusUnauthorized, "unauthenticated")
	u, bystander := p.createUser(t), p.createUser(t)
	first := p.signIn(t, u)
	src := sourceRef{App: "expo", InstallID: "inst-rd-1", LocalProfileID: "lrn-rd-1"}
	ev := func(n int) []byte {
		return answer{id: fmt.Sprintf("ans-rd-%d", n), learner: src.LocalProfileID, install: src.InstallID, at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	frozen := importBody("imp-rd-1", src, newAdult, ev(1), ev(2))
	r := s.call(t, http.MethodPost, "/v1/imports", first.access, frozen)
	wantStatus(t, r, http.StatusCreated)
	var created receipt
	decodeJSON(t, r.body, &created)
	pid := created.ProfileID
	if up := s.upload(t, first.access, pid, ev(3)); up.Results[0].Status != http.StatusCreated {
		t.Fatalf("upload = %+v", up.Results[0])
	}
	theirs := p.signIn(t, bystander)
	r = s.call(t, http.MethodPost, "/v1/imports", theirs.access, importBody("imp-rd-1", src, newAdult, ev(1)))
	wantStatus(t, r, http.StatusCreated)
	var their receipt
	decodeJSON(t, r.body, &their)
	bystanderAccount := s.accountOf(t, theirs.access)
	account := s.accountOf(t, first.access)
	step := func(name string, f func(t *testing.T)) {
		if !t.Run(name, f) {
			t.FailNow()
		}
	}
	var pending deletionDoc
	var again authSession

	step("the deletion needs the exact confirmation of the caller's own account", func(t *testing.T) {
		for _, body := range [][]byte{
			[]byte(`{"confirm":"DELETE-ACCOUNT","account_id":"` + account + `"}`),
			deletionBody(bystanderAccount),
			deletionBody(nobodysAccount),
		} {
			wantProblem(t, s.call(t, http.MethodPost, deletionPath, first.access, body), http.StatusUnprocessableEntity, "deletion_not_confirmed")
		}
		if n := s.count(t, `SELECT count(*) FROM profiles WHERE account_id = $1::uuid`, account); n != 1 {
			t.Fatal("a refused deletion request erased data")
		}
	})

	step("a provider refusal after the erasure is an honest pending deletion", func(t *testing.T) {
		r := s.deleteAccount(t, first.access, account)
		pending = wantDeletion(t, r, http.StatusAccepted, account, "identity_deletion_pending")
		wantErased(t, pending, 1, 1, 3, 1)
		if pending.IdentityProvider.Attempts != 1 {
			t.Fatalf("identity attempts = %d, want 1", pending.IdentityProvider.Attempts)
		}
		if bytes.Contains(r.body, []byte(wrongKey)) || bytes.Contains(r.body, []byte(p.admin)) {
			t.Fatal("the answer quotes an admin credential")
		}
		if !p.exists(t, u.id) {
			t.Fatal("the real Auth deleted the user despite the refused credential")
		}
		s.wantGone(t, u.id, account, pid)
		wantProblem(t, s.call(t, http.MethodGet, "/v1/me", first.access, nil), http.StatusGone, "account_deleted")
		g := wantDeletion(t, s.call(t, http.MethodGet, deletionPath, first.access, nil), http.StatusOK, account, "identity_deletion_pending")
		if g.DeletionID != pending.DeletionID || g.RequestedAt != pending.RequestedAt || g.ServerData != pending.ServerData {
			t.Fatalf("GET deletion = %+v, want the pending deletion %+v", g, pending)
		}
		if s.accountOf(t, theirs.access) != bystanderAccount {
			t.Fatal("another user's session did not outlive the deletion")
		}
	})

	step("after a restart with the server credential, a new password sign-in completes the same deletion", func(t *testing.T) {
		s.stop()
		s.startReal(t, fx, fx.adminKeyFile)
		again = p.signIn(t, u)
		wantProblem(t, s.call(t, http.MethodGet, "/v1/me", again.access, nil), http.StatusGone, "account_deleted")
		d := wantDeletion(t, s.deleteAccount(t, again.access, account), http.StatusOK, account, "completed")
		if d.DeletionID != pending.DeletionID || d.RequestedAt != pending.RequestedAt || d.ServerData != pending.ServerData ||
			d.IdentityProvider.Attempts != 2 {
			t.Fatalf("completion = %+v, want deletion %s again, completed on its second identity attempt", d, pending.DeletionID)
		}
	})

	step("the real Auth no longer has the user, and nothing of the account comes back", func(t *testing.T) {
		if p.exists(t, u.id) {
			t.Fatal("the real Auth still has the user after a completed deletion")
		}
		for _, c := range []struct{ what, token string }{
			{"the first session's access token", first.access}, {"the new session's access token", again.access},
		} {
			wantSameUnauthenticated(t, s, c.token, uniform, c.what)
		}
		if _, status := p.refresh(t, again.refresh); status == http.StatusOK {
			t.Fatal("a deleted user's refresh token still refreshes")
		}
		if _, status := p.trySignIn(t, u); status == http.StatusOK {
			t.Fatal("a deleted user signed in with its password")
		}
		wantProblem(t, s.call(t, http.MethodPost, "/v1/imports", first.access, frozen), http.StatusUnauthorized, "unauthenticated")
		s.wantGone(t, u.id, account, pid)
		if n := s.count(t, `SELECT count(*) FROM account_deletions d JOIN accounts a USING (account_id)
			WHERE d.account_id = $1::uuid AND d.identity_deleted_at IS NOT NULL AND a.subject = $2`, account, u.id); n != 1 {
			t.Fatal("the deletion record and the account's identity row did not both stay")
		}
		if pg := s.pull(t, theirs.access, their.ProfileID, "after=0"); len(pg.Events) != 1 || !bytes.Equal(pg.Events[0].Payload, payloadOf(t, ev(1))) {
			t.Fatal("the other account's record with the same device identifiers and event ID changed")
		}
	})
}
