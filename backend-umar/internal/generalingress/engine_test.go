package generalingress

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

const origin = "https://general-beta.example.invalid"
const userA = "10000000-0000-0000-0000-000000000001"
const userB = "10000000-0000-0000-0000-000000000002"
const learnerA = "20000000-0000-0000-0000-000000000001"
const learnerB = "20000000-0000-0000-0000-000000000002"
const sidA = "30000000-0000-0000-0000-000000000001"
const sidB = "30000000-0000-0000-0000-000000000002"

type testClock struct {
	wall time.Time
	mono time.Duration
}

func (c *testClock) Now() time.Time          { return c.wall }
func (c *testClock) Elapsed() time.Duration  { return c.mono }
func (c *testClock) advance(d time.Duration) { c.wall = c.wall.Add(d); c.mono += d }

type verifierDouble struct {
	claims map[string]Claims
	fail   bool
}

func (*verifierDouble) OfflineOnly() bool { return true }
func (v *verifierDouble) Verify(_ context.Context, token string) (Claims, error) {
	c, ok := v.claims[token]
	if !ok || v.fail {
		return Claims{}, errors.New("rejected")
	}
	return c, nil
}

type providerDouble struct {
	sessions       map[string]Session
	users          map[string]User
	mail           []MailRequest
	mailErr        error
	authErr        error
	redirect       bool
	logoutErr      bool
	block, entered chan struct{}
	enterOnce      sync.Once
	verifyUsed     map[string]bool
	mailHook       func()
	authCalls      int
}

func (*providerDouble) OfflineOnly() bool { return true }
func (p *providerDouble) Mail(ctx context.Context, in MailRequest) error {
	p.mail = append(p.mail, in)
	if p.mailHook != nil {
		p.mailHook()
	}
	if p.block != nil {
		p.enterOnce.Do(func() { close(p.entered) })
		select {
		case <-p.block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return p.mailErr
}
func (p *providerDouble) Authenticate(_ context.Context, a AuthRequest) (Session, error) {
	p.authCalls++
	if p.authErr != nil {
		return Session{}, p.authErr
	}
	key := a.Grant + ":" + a.Email
	if a.Grant == "refresh_token" {
		key = "refresh:" + a.RefreshToken
	}
	if a.Grant == "otp" {
		key = "otp:" + a.Email + ":" + a.Type + ":" + a.Code
		if p.verifyUsed[key] {
			return Session{}, ErrDenied
		}
		p.verifyUsed[key] = true
	}
	s, ok := p.sessions[key]
	if !ok {
		return Session{}, ErrDenied
	}
	if p.redirect {
		s.Redirect = origin + "/elsewhere"
	}
	return s, nil
}
func (p *providerDouble) Inspect(_ context.Context, token string) (User, error) {
	u, ok := p.users[token]
	if !ok {
		return User{}, errors.New("no user")
	}
	return u, nil
}
func (p *providerDouble) Logout(_ context.Context, token string) error {
	if p.logoutErr {
		return errors.New("uncertain")
	}
	u := p.users[token]
	u.Revoked = true
	p.users[token] = u
	return nil
}
func (p *providerDouble) UpdatePassword(_ context.Context, token, password string) (User, error) {
	return p.Inspect(context.Background(), token)
}

type backendDouble struct {
	calls    int
	progress map[string]int
}

func (*backendDouble) OfflineOnly() bool { return true }
func (*backendDouble) Owns(_ context.Context, c Claims, id string, _ string) (bool, error) {
	return c.Issuer == origin && ((c.Subject == userA && id == learnerA) || (c.Subject == userB && id == learnerB)), nil
}
func (b *backendDouble) Call(_ context.Context, c Claims, method, target string, body []byte, _ string) (any, error) {
	b.calls++
	key := c.Issuer + "|" + c.Subject
	if strings.HasSuffix(target, "/events") && method == "POST" {
		b.progress[key]++
	}
	return b.progress[key], nil
}

type fixture struct {
	e *Engine
	c *testClock
	v *verifierDouble
	p *providerDouble
	b *backendDouble
}

func setup(t *testing.T, change func(*Policy)) fixture {
	t.Helper()
	c := &testClock{wall: time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)}
	v := &verifierDouble{claims: map[string]Claims{}}
	p := &providerDouble{sessions: map[string]Session{}, users: map[string]User{}, verifyUsed: map[string]bool{}}
	b := &backendDouble{progress: map[string]int{}}
	policy := Policy{Simulation: true, MailEnabled: true, Origin: origin, Issuer: origin, Audience: "authenticated", Deadline: c.wall.Add(time.Hour), MaxConcurrent: 4, MailGlobal: 20, MailRecipientHour: 3, MailIPHour: 10, MailCooldown: time.Minute, AuthIPMinute: 100, AuthRecipientMinute: 20, MaxState: 1000}
	if change != nil {
		change(&policy)
	}
	e, err := New(policy, c, v, p, b)
	if err != nil {
		t.Fatal(err)
	}
	f := fixture{e, c, v, p, b}
	f.issue("a", userA, sidA, "first@example.invalid", "password")
	f.issue("b", userB, sidB, "second@example.invalid", "password")
	return f
}
func (f fixture) issue(prefix, id, sid, email, method string) Session {
	s := Session{AccessToken: prefix + "-access", RefreshToken: prefix + "-refresh"}
	f.v.claims[s.AccessToken] = Claims{Issuer: origin, Audience: "authenticated", Subject: id, SessionID: sid, Role: "authenticated", ExpiresAt: f.c.wall.Add(time.Hour), AuthTime: f.c.wall, Method: method}
	f.p.users[s.AccessToken] = User{ID: id, SessionID: sid, Email: email, Confirmed: true}
	f.p.sessions["password:"+email] = s
	return s
}
func req(method, target, body string) Request {
	headers := [][2]string{{"Host", "general-beta.example.invalid"}, {"X-Request-ID", "request-local-1"}}
	if body != "" {
		headers = append(headers, [2]string{"Content-Type", "application/json"})
	}
	return Request{Method: method, Target: target, Peer: "192.0.2.1", TLS: true, Headers: headers, Body: []byte(body)}
}
func authed(method, target, body, token string) Request {
	r := req(method, target, body)
	r.Headers = append(r.Headers, [2]string{"Authorization", "Bearer " + token})
	return r
}
func handle(f fixture, r Request) Response { return f.e.Handle(context.Background(), r) }
func login(t *testing.T, f fixture, email string) Session {
	t.Helper()
	r := handle(f, req("POST", "/token?grant_type=password", `{"email":"`+email+`","password":"test-password-123"}`))
	if r.Status != 200 || r.Session == nil {
		t.Fatalf("login rejected: %d %s", r.Status, r.Code)
	}
	return *r.Session
}

func TestDefaultClosedAndNoRealTransport(t *testing.T) {
	e, err := New(Policy{}, nil, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if r := e.Handle(context.Background(), req("GET", "/healthz", "")); r.Status != 503 {
		t.Fatal("default not closed")
	}
	f := setup(t, func(p *Policy) { p.MailEnabled = false })
	if r := handle(f, req("POST", "/signup", `{"email":"new@example.invalid","password":"test-password-123"}`)); r.Status != 503 || len(f.p.mail) != 0 {
		t.Fatal("held mail forwarded")
	}
	if r := handle(f, req("GET", "/healthz", "")); r.Status != 200 {
		t.Fatal("health unavailable in simulation")
	}
}

func TestGeneralSignupAcceptsIndependentRecipientsWithoutSessions(t *testing.T) {
	f := setup(t, nil)
	for i, email := range []string{"someone@example.invalid", "another@example.invalid", "third@different.invalid"} {
		r := req("POST", "/signup", `{"email":"`+email+`","password":"test-password-123"}`)
		r.Headers[1][1] = fmt.Sprintf("independent-%d", i)
		got := handle(f, r)
		if got.Status != 202 || got.Session != nil {
			t.Fatal("general signup must await confirmation")
		}
	}
	if len(f.p.mail) != 3 || f.e.Snapshot().MailReserved != 3 {
		t.Fatal("not exactly one reservation per recipient")
	}
}

func TestRequestBoundaryRefusesAliasesFramingAndForbiddenRoutes(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Request)
	}{
		{"tls", func(r *Request) { r.TLS = false }},
		{"host", func(r *Request) { r.Headers[0][1] = "attacker.invalid" }},
		{"duplicate-host", func(r *Request) { r.Headers = append(r.Headers, [2]string{"host", "general-beta.example.invalid"}) }},
		{"transfer-encoding", func(r *Request) { r.Headers = append(r.Headers, [2]string{"Transfer-Encoding", "chunked"}) }},
		{"content-length", func(r *Request) { r.Headers = append(r.Headers, [2]string{"Content-Length", "1"}) }},
		{"proxy-ip", func(r *Request) { r.Headers = append(r.Headers, [2]string{"X-Forwarded-For", "127.0.0.1"}) }},
		{"header-newline", func(r *Request) { r.Headers = append(r.Headers, [2]string{"X-Test", "ok\r\nX-Foo: evil"}) }},
		{"encoded-path", func(r *Request) { r.Target = "/%73ignup" }},
		{"path-traversal", func(r *Request) { r.Target = "/admin/../signup" }},
		{"absolute-target", func(r *Request) { r.Target = origin + "/signup" }},
		{"query-redirect", func(r *Request) { r.Target = "/signup?redirect_to=https://attacker.invalid" }},
		{"duplicate-json", func(r *Request) {
			r.Body = []byte(`{"email":"one@example.invalid","email":"two@example.invalid","password":"test-password-123"}`)
		}},
		{"case-json", func(r *Request) { r.Body = []byte(`{"EMAIL":"one@example.invalid","password":"test-password-123"}`) }},
		{"metadata", func(r *Request) {
			r.Body = []byte(`{"email":"one@example.invalid","password":"test-password-123","data":{"role":"admin"}}`)
		}},
		{"invalid-email", func(r *Request) {
			r.Body = []byte(`{"email":"Someone <one@example.invalid>","password":"test-password-123"}`)
		}},
		{"short-password", func(r *Request) { r.Body = []byte(`{"email":"one@example.invalid","password":"short"}`) }},
		{"oversized", func(r *Request) { r.Body = make([]byte, 16385) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t, nil)
			r := req("POST", "/signup", `{"email":"one@example.invalid","password":"test-password-123"}`)
			tc.mutate(&r)
			got := handle(f, r)
			if got.Status < 400 || len(f.p.mail) != 0 {
				t.Fatal("unsafe input forwarded")
			}
		})
	}
	for _, path := range []string{"/admin/users", "/recover/admin", "/settings", "/.well-known/jwks.json", "/mail", "/authorize", "/invite", "/v1/account/delete", "/signup/", "/token?grant_type=password&grant_type=refresh_token"} {
		f := setup(t, nil)
		if r := handle(f, req("POST", path, `{}`)); r.Status < 400 {
			t.Fatalf("unlisted route %s allowed", path)
		}
	}
}

func TestConfirmedIdentityBindingAndMaliciousProviderResponses(t *testing.T) {
	for _, change := range []struct {
		name  string
		apply func(fixture)
	}{
		{"issuer", func(f fixture) {
			c := f.v.claims["a-access"]
			c.Issuer = "https://other.invalid"
			f.v.claims["a-access"] = c
		}},
		{"audience", func(f fixture) { c := f.v.claims["a-access"]; c.Audience = "other"; f.v.claims["a-access"] = c }},
		{"role", func(f fixture) { c := f.v.claims["a-access"]; c.Role = "service_role"; f.v.claims["a-access"] = c }},
		{"anonymous", func(f fixture) { c := f.v.claims["a-access"]; c.Anonymous = true; f.v.claims["a-access"] = c }},
		{"expired", func(f fixture) { c := f.v.claims["a-access"]; c.ExpiresAt = f.c.wall; f.v.claims["a-access"] = c }},
		{"bad-uuid", func(f fixture) {
			c := f.v.claims["a-access"]
			c.Subject = "email-is-not-an-owner"
			f.v.claims["a-access"] = c
		}},
		{"bad-session", func(f fixture) { c := f.v.claims["a-access"]; c.SessionID = "session-text"; f.v.claims["a-access"] = c }},
		{"unconfirmed", func(f fixture) { u := f.p.users["a-access"]; u.Confirmed = false; f.p.users["a-access"] = u }},
		{"crossed-user", func(f fixture) { u := f.p.users["a-access"]; u.ID = userB; f.p.users["a-access"] = u }},
		{"crossed-session", func(f fixture) { u := f.p.users["a-access"]; u.SessionID = sidB; f.p.users["a-access"] = u }},
		{"crossed-email", func(f fixture) {
			u := f.p.users["a-access"]
			u.Email = "other@example.invalid"
			f.p.users["a-access"] = u
		}},
		{"revoked", func(f fixture) { u := f.p.users["a-access"]; u.Revoked = true; f.p.users["a-access"] = u }},
		{"verifier-error", func(f fixture) { f.v.fail = true }},
		{"redirect", func(f fixture) { f.p.redirect = true }},
	} {
		t.Run(change.name, func(t *testing.T) {
			f := setup(t, nil)
			change.apply(f)
			r := handle(f, req("POST", "/token?grant_type=password", `{"email":"first@example.invalid","password":"test-password-123"}`))
			if r.Status < 400 || r.Session != nil {
				t.Fatal("unverified identity accepted")
			}
		})
	}
}

func TestAccountUUIDIsolationProgressAndLogout(t *testing.T) {
	f := setup(t, nil)
	a := login(t, f, "first@example.invalid")
	b := login(t, f, "second@example.invalid")
	if r := handle(f, req("GET", "/v1/learners/"+learnerA+"/events", "")); r.Status != 401 {
		t.Fatal("anonymous data access")
	}
	for _, tc := range []struct {
		token, id string
		status    int
	}{{a.AccessToken, learnerA, 200}, {b.AccessToken, learnerB, 200}, {a.AccessToken, learnerB, 404}, {b.AccessToken, learnerA, 404}} {
		r := handle(f, authed("GET", "/v1/learners/"+tc.id+"/events", "", tc.token))
		if r.Status != tc.status {
			t.Fatal("owner boundary failed", r.Status)
		}
	}
	if r := handle(f, authed("POST", "/v1/learners/"+learnerA+"/events", `{"schema_version":1,"synthetic":false,"events":["opaque-native-event"]}`, a.AccessToken)); r.Status != 200 {
		t.Fatal(r.Code)
	}
	if r := handle(f, authed("GET", "/v1/learners/"+learnerB+"/events", "", b.AccessToken)); r.Data != 0 {
		t.Fatal("progress crossed accounts")
	}
	if r := handle(f, authed("POST", "/logout?scope=local", "", a.AccessToken)); r.Status != 204 {
		t.Fatal(r.Code)
	}
	if r := handle(f, authed("GET", "/user", "", a.AccessToken)); r.Status != 401 {
		t.Fatal("stale access after logout")
	}
	if r := handle(f, authed("GET", "/user", "", b.AccessToken)); r.Status != 200 {
		t.Fatal("other account logged out")
	}
	if r := handle(f, req("POST", "/token?grant_type=refresh_token", `{"refresh_token":"a-refresh"}`)); r.Status != 401 {
		t.Fatal("stale refresh after logout")
	}
}

func TestRefreshRotationCrossIdentityAndUnknownOutcome(t *testing.T) {
	for _, mode := range []string{"valid", "cross-user", "cross-session", "uncertain"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t, nil)
			login(t, f, "first@example.invalid")
			s := f.issue("rotated", userA, sidA, "first@example.invalid", "password")
			if mode == "cross-user" {
				s = f.issue("cross", userB, sidB, "second@example.invalid", "password")
			}
			if mode == "cross-session" {
				s = f.issue("cross", userA, sidB, "first@example.invalid", "password")
			}
			f.p.sessions["refresh:a-refresh"] = s
			if mode == "uncertain" {
				f.p.authErr = errors.New("lost response")
			}
			r := handle(f, req("POST", "/token?grant_type=refresh_token", `{"refresh_token":"a-refresh"}`))
			if mode == "valid" {
				if r.Status != 200 || r.Session.AccessToken != "rotated-access" {
					t.Fatal("rotation failed")
				}
			} else if r.Status < 400 {
				t.Fatal("unsafe refresh accepted")
			}
			if r := handle(f, req("POST", "/token?grant_type=refresh_token", `{"refresh_token":"a-refresh"}`)); r.Status != 401 {
				t.Fatal("old refresh replay allowed")
			}
			if r := handle(f, authed("GET", "/user", "", "a-access")); r.Status != 401 {
				t.Fatal("old token restored after rotation/failure")
			}
		})
	}
}

func TestOTPRecoveryReplayAndPasswordUpdateBoundary(t *testing.T) {
	f := setup(t, nil)
	s := f.issue("confirm", userA, sidA, "first@example.invalid", "otp")
	f.p.sessions["otp:first@example.invalid:signup:123456"] = s
	verify := req("POST", "/verify", `{"email":"first@example.invalid","token":"123456","type":"signup"}`)
	if r := handle(f, verify); r.Status != 200 {
		t.Fatal("confirmation rejected")
	}
	if r := handle(f, verify); r.Status != 401 {
		t.Fatal("OTP replay accepted")
	}
	if r := handle(f, authed("PUT", "/user", `{"password":"new-test-password"}`, s.AccessToken)); r.Status != 403 {
		t.Fatal("signup used as recovery")
	}
	recovery := f.issue("recover", userA, sidA, "first@example.invalid", "email/recovery")
	f.p.sessions["otp:first@example.invalid:recovery:654321"] = recovery
	if r := handle(f, req("POST", "/verify", `{"email":"first@example.invalid","token":"654321","type":"recovery"}`)); r.Status != 200 {
		t.Fatal("recovery verification failed")
	}
	if r := handle(f, authed("PUT", "/user", `{"password":"new-test-password"}`, recovery.AccessToken)); r.Status != 200 {
		t.Fatal("password update rejected")
	}
	if r := handle(f, authed("PUT", "/user", `{"password":"another-password"}`, recovery.AccessToken)); r.Status != 401 {
		t.Fatal("recovery grant replay accepted")
	}
	for _, body := range []string{`{"email":"second@example.invalid","token":"123456","type":"signup"}`, `{"email":"first@example.invalid","token":"000000","type":"magiclink"}`, `{"email":"first@example.invalid","token":"12345","type":"signup"}`} {
		if r := handle(f, req("POST", "/verify", body)); r.Status < 400 {
			t.Fatal("OTP recipient/type mismatch accepted")
		}
	}
}

func TestMailAtomicBudgetCooldownReplayAndUncertainSend(t *testing.T) {
	f := setup(t, func(p *Policy) { p.MailGlobal = 2 })
	f.p.mailErr = errors.New("possibly forwarded; private provider error must not escape")
	r := req("POST", "/recover", `{"email":"first@example.invalid"}`)
	if got := handle(f, r); got.Status != 503 || strings.Contains(got.Code, "private") {
		t.Fatal("ambiguous outcome falsely reported")
	}
	if got := handle(f, r); got.Status != 409 || len(f.p.mail) != 1 {
		t.Fatal("replay sent again")
	}
	r.Headers[1][1] = "second-id"
	if got := handle(f, r); got.Status != 429 {
		t.Fatal("cooldown bypassed")
	}
	f.c.advance(time.Minute)
	f.p.mailErr = nil
	if got := handle(f, r); got.Status != 202 {
		t.Fatal("next permitted recovery rejected")
	}
	r = req("POST", "/resend", `{"email":"second@example.invalid","type":"signup"}`)
	r.Headers[1][1] = "third-id"
	if got := handle(f, r); got.Status != 429 || len(f.p.mail) != 2 || f.e.Snapshot().MailReserved != 2 {
		t.Fatal("global budget exceeded/refunded")
	}
}

func TestMailLimitsShareActionsAndRecipientAliases(t *testing.T) {
	for _, mode := range []string{"recipient", "ip"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t, func(p *Policy) {
				if mode == "recipient" {
					p.MailRecipientHour = 1
				} else {
					p.MailIPHour = 1
				}
			})
			if r := handle(f, req("POST", "/recover", `{"email":"first@example.invalid"}`)); r.Status != 202 {
				t.Fatal(r.Code)
			}
			f.c.advance(time.Minute)
			email := "FIRST@example.invalid"
			if mode == "ip" {
				email = "second@example.invalid"
			}
			r := req("POST", "/resend", `{"email":"`+email+`","type":"signup"}`)
			r.Headers[1][1] = "other-action"
			if got := handle(f, r); got.Status != 429 || len(f.p.mail) != 1 {
				t.Fatal("shared budget bypassed")
			}
		})
	}
}

func TestAuthAttemptsRateLimitedWithoutPermanentAccountLock(t *testing.T) {
	f := setup(t, func(p *Policy) { p.AuthRecipientMinute = 1 })
	login(t, f, "first@example.invalid")
	if r := handle(f, req("POST", "/verify", `{"email":"FIRST@example.invalid","token":"000000","type":"signup"}`)); r.Status != 429 {
		t.Fatal("recipient auth rate bypass")
	}
	f.c.advance(time.Minute)
	login(t, f, "first@example.invalid")
}

func TestClockExpiryContextAndStateCapacityFailClosed(t *testing.T) {
	for _, mode := range []string{"expiry", "wall-reversal", "mono-reversal", "mono-expiry"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t, nil)
			login(t, f, "first@example.invalid")
			switch mode {
			case "expiry":
				f.c.wall = f.c.wall.Add(time.Hour)
			case "wall-reversal":
				f.c.wall = f.c.wall.Add(-time.Second)
			case "mono-reversal":
				f.c.mono = -time.Second
			case "mono-expiry":
				f.c.mono = time.Hour
			}
			if r := handle(f, authed("GET", "/user", "", "a-access")); r.Status != 503 {
				t.Fatal("invalid lease accepted")
			}
			f.c.wall = time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
			f.c.mono = 0
			if r := handle(f, req("GET", "/healthz", "")); r.Status != 503 {
				t.Fatal("lease renewed after failure")
			}
		})
	}
	f := setup(t, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if r := f.e.Handle(ctx, req("POST", "/recover", `{"email":"first@example.invalid"}`)); r.Status != 503 || len(f.p.mail) != 0 {
		t.Fatal("cancelled request forwarded")
	}
	f = setup(t, func(p *Policy) { p.MaxState = 1 })
	login(t, f, "first@example.invalid")
	if r := handle(f, req("POST", "/token?grant_type=password", `{"email":"second@example.invalid","password":"test-password-123"}`)); r.Status != 503 {
		t.Fatal("unbounded session state")
	}
}

func TestConcurrencyBoundAndSecretFreeCounters(t *testing.T) {
	f := setup(t, func(p *Policy) { p.MaxConcurrent = 1 })
	f.p.block = make(chan struct{})
	f.p.entered = make(chan struct{})
	done := make(chan Response, 1)
	go func() { done <- handle(f, req("POST", "/recover", `{"email":"first@example.invalid"}`)) }()
	select {
	case <-f.p.entered:
	case <-time.After(time.Second):
		t.Fatal("bounded test did not enter provider")
	}
	if r := handle(f, req("GET", "/healthz", "")); r.Status != 429 {
		t.Fatal("concurrency bound ignored")
	}
	close(f.p.block)
	select {
	case r := <-done:
		if r.Status != 202 {
			t.Fatal(r.Code)
		}
	case <-time.After(time.Second):
		t.Fatal("owned test goroutine not complete")
	}
	text := fmt.Sprint(f.e.Counters(), f.e.Snapshot(), Session{AccessToken: "private-token", RefreshToken: "private-refresh"})
	for _, secret := range []string{"first@example.invalid", "test-password-123", "private-token", "private-refresh", "192.0.2.1"} {
		if strings.Contains(text, secret) {
			t.Fatal("counter/diagnostic leak")
		}
	}
}

func TestRefreshAttemptsShareAnonymousIPRateBudget(t *testing.T) {
	f := setup(t, func(p *Policy) { p.AuthIPMinute = 1 })
	login(t, f, "first@example.invalid")
	if r := handle(f, req("POST", "/token?grant_type=refresh_token", `{"refresh_token":"unknown-token"}`)); r.Status != 429 {
		t.Fatalf("refresh bypassed IP bucket: %d", r.Status)
	}
}

func TestExactQueryAndAuthenticatedMethodEvidence(t *testing.T) {
	for _, target := range []string{"/token?grant_type=password&", "/token?grant_type=password;", "/logout?scope=local&"} {
		f := setup(t, nil)
		r := req("POST", target, `{"email":"first@example.invalid","password":"test-password-123"}`)
		if strings.HasPrefix(target, "/logout") {
			r.Body = nil
			r.Headers = r.Headers[:2]
		}
		if got := handle(f, r); got.Status != 400 {
			t.Errorf("ambiguous query accepted: %s, %d", target, got.Status)
		}
	}
	for _, method := range []string{"", "unrecognized", "email/recovery"} {
		f := setup(t, nil)
		c := f.v.claims["a-access"]
		c.Method = method
		f.v.claims["a-access"] = c
		if r := handle(f, req("POST", "/token?grant_type=password", `{"email":"first@example.invalid","password":"test-password-123"}`)); r.Status != 401 {
			t.Errorf("password login without password evidence: %q", method)
		}
	}
}

func TestConcurrentMailRetryReservesAndForwardsOnlyOnce(t *testing.T) {
	f := setup(t, nil)
	f.p.block = make(chan struct{})
	f.p.entered = make(chan struct{})
	done := make(chan Response, 2)
	request := req("POST", "/signup", `{"email":"new@example.invalid","password":"test-password-123"}`)
	go func() { done <- handle(f, request) }()
	select {
	case <-f.p.entered:
	case <-time.After(time.Second):
		t.Fatal("first request stalled")
	}
	go func() { done <- handle(f, request) }()
	close(f.p.block)
	statuses := map[int]int{}
	for i := 0; i < 2; i++ {
		select {
		case r := <-done:
			statuses[r.Status]++
		case <-time.After(time.Second):
			t.Fatal("owned test goroutine did not finish")
		}
	}
	if statuses[202] != 1 || statuses[409] != 1 || len(f.p.mail) != 1 || f.e.Snapshot().MailReserved != 1 {
		t.Fatal("concurrent retry sent/reserved twice")
	}
}

func TestRecoveryFreshnessAndLogoutFailureStillClearOnlyOwnBinding(t *testing.T) {
	f := setup(t, nil)
	a := login(t, f, "first@example.invalid")
	b := login(t, f, "second@example.invalid")
	f.p.logoutErr = true
	if r := handle(f, authed("POST", "/logout?scope=local", "", a.AccessToken)); r.Status != 503 {
		t.Fatal("uncertain logout falsely reported")
	}
	if r := handle(f, authed("GET", "/user", "", a.AccessToken)); r.Status != 401 {
		t.Fatal("uncertain logout retained local access")
	}
	if r := handle(f, authed("GET", "/user", "", b.AccessToken)); r.Status != 200 {
		t.Fatal("logout touched another user")
	}
	f = setup(t, nil)
	s := f.issue("recovery", userA, sidA, "first@example.invalid", "email/recovery")
	f.p.sessions["otp:first@example.invalid:recovery:123456"] = s
	if r := handle(f, req("POST", "/verify", `{"email":"first@example.invalid","token":"123456","type":"recovery"}`)); r.Status != 200 {
		t.Fatal(r.Code)
	}
	f.c.advance(5 * time.Minute)
	if r := handle(f, authed("PUT", "/user", `{"password":"new-test-password"}`, s.AccessToken)); r.Status != 403 {
		t.Fatal("expired recovery grant accepted")
	}
}

func TestNoSevenDayPolicyOrRealOriginCanBeConstructed(t *testing.T) {
	f := setup(t, nil)
	p := f.e.p
	for _, change := range []func(*Policy){func(p *Policy) { p.Deadline = f.c.wall.Add(7 * 24 * time.Hour) }, func(p *Policy) { p.Origin = "https://real-service.example.com"; p.Issuer = p.Origin }, func(p *Policy) { p.MaxConcurrent = 100 }, func(p *Policy) { p.MaxState = 0 }, func(p *Policy) { p.MailGlobal = 0 }} {
		bad := p
		change(&bad)
		if _, err := New(bad, f.c, f.v, f.p, f.b); err == nil {
			t.Fatal("invalid activation/lifetime policy accepted")
		}
	}
}

func TestBackendRequestsCannotSupplyAnotherOwnerOrSyntheticLane(t *testing.T) {
	f := setup(t, func(p *Policy) { p.DeclarationVersion = "fixture-adult-v1"; p.ConsentVersion = "fixture-sync-v1" })
	login(t, f, "first@example.invalid")
	for _, tc := range []struct{ target, body string }{
		{"/v1/account", `{"adult_confirmed":true,"declaration_version":"fixture-adult-v1","synthetic":false,"owner_id":"foreign"}`},
		{"/v1/learners", `{"client_learner_id":"local","kind":"ADULT","lang":"id","synthetic":true}`},
		{"/v1/learners", `{"client_learner_id":"local","kind":"ANAK","lang":"id","synthetic":false}`},
		{"/v1/learners/" + learnerA + "/consent", `{"version":"other","granted":true,"synthetic":false}`},
		{"/v1/learners/" + learnerA + "/events", `{"schema_version":1,"synthetic":true,"events":["event"]}`},
	} {
		if r := handle(f, authed("POST", tc.target, tc.body, "a-access")); r.Status != 400 {
			t.Fatal("unsafe backend request accepted")
		}
	}
	if f.b.calls != 0 {
		t.Fatal("invalid request reached backend")
	}
	if r := handle(f, authed("POST", "/v1/account", `{"adult_confirmed":true,"declaration_version":"fixture-adult-v1","synthetic":false}`, "a-access")); r.Status != 200 {
		t.Fatal("valid declaration refused")
	}
	if r := handle(f, authed("POST", "/v1/learners", `{"client_learner_id":"same-local-id","kind":"ADULT","lang":"id","synthetic":false}`, "a-access")); r.Status != 200 {
		t.Fatal("valid adult profile refused")
	}
}

func TestProviderPanicAndExpiryDuringSendDoNotRenewOrRefund(t *testing.T) {
	for _, mode := range []string{"panic", "expiry"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t, nil)
			login(t, f, "first@example.invalid")
			f.p.mailHook = func() {
				if mode == "panic" {
					panic("private provider failure")
				}
				f.c.advance(time.Hour)
			}
			r := handle(f, req("POST", "/recover", `{"email":"first@example.invalid"}`))
			if r.Status != 503 || f.e.Snapshot().MailReserved != 1 || !f.e.Snapshot().Halted || f.e.Snapshot().ActiveSessions != 0 {
				t.Fatal("uncertain send did not leave closed state")
			}
			if r := handle(f, req("GET", "/healthz", "")); r.Status != 503 {
				t.Fatal("failure auto-reopened")
			}
		})
	}
}

func TestRecoveryAcceptsProviderOTPButNeverStaleAuthentication(t *testing.T) {
	for _, stale := range []bool{false, true} {
		f := setup(t, nil)
		s := f.issue("native-otp", userA, sidA, "first@example.invalid", "otp")
		if stale {
			c := f.v.claims[s.AccessToken]
			c.AuthTime = f.c.wall.Add(-6 * time.Minute)
			f.v.claims[s.AccessToken] = c
		}
		f.p.sessions["otp:first@example.invalid:recovery:123456"] = s
		r := handle(f, req("POST", "/verify", `{"email":"first@example.invalid","token":"123456","type":"recovery"}`))
		if !stale && r.Status != 200 {
			t.Error("native OTP recovery method refused")
		}
		if stale && r.Status != 401 {
			t.Error("stale recovery authentication accepted")
		}
	}
}

func TestSharedSessionUUIDCannotRebindToAnotherOwner(t *testing.T) {
	f := setup(t, nil)
	login(t, f, "first@example.invalid")
	f.issue("collision", userB, sidA, "second@example.invalid", "password")
	if r := handle(f, req("POST", "/token?grant_type=password", `{"email":"second@example.invalid","password":"test-password-123"}`)); r.Status != 401 {
		t.Fatal("session UUID rebound to another owner")
	}
	if r := handle(f, authed("GET", "/user", "", "a-access")); r.Status != 200 {
		t.Fatal("rejected rebind damaged existing owner")
	}
}

func TestUncertainVerificationNeverBlindRetriesOrMisreportsPassword(t *testing.T) {
	f := setup(t, nil)
	f.p.authErr = errors.New("response possibly lost with private details")
	r := req("POST", "/verify", `{"email":"first@example.invalid","token":"123456","type":"signup"}`)
	if got := handle(f, r); got.Status != 503 || strings.Contains(got.Code, "private") {
		t.Fatal("dependency failure reported as invalid credentials")
	}
	if got := handle(f, r); got.Status != 401 || f.p.authCalls != 1 {
		t.Fatal("uncertain verification forwarded again")
	}
}
