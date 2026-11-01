package generalingress

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func runtimeFixture(t *testing.T) (RuntimeConfig, *Engine, fixture, *testClock) {
	t.Helper()
	f := setup(t, nil)
	clock := f.c
	for token, u := range f.p.users {
		u.ConfirmedAt = "2026-01-01T00:00:00Z"
		f.p.users[token] = u
	}
	p := Policy{Origin: origin, Issuer: origin, Audience: "authenticated", Deadline: clock.Now().Add(time.Hour), MaxConcurrent: 4, MailGlobal: 8, MailRecipientHour: 3, MailIPHour: 8, MailCooldown: time.Minute, AuthIPMinute: 60, AuthRecipientMinute: 10, MaxState: 1000, DeclarationVersion: "fixture-adult-v1", ConsentVersion: "fixture-sync-v1"}
	c := RuntimeConfig{Enabled: true, Listen: "127.0.0.1:58480", UpstreamOrigin: "https://localhost:58443", CAHash: strings.Repeat("a", 64), Revocation: AllowBoundedJWT, MaxAccessWindow: time.Hour, Policy: ordinaryPolicyFixture(p)}
	e, err := NewRuntime(c, clock, f.v, f.p, f.b)
	if err != nil {
		t.Fatal(err)
	}
	return c, e, f, clock
}

func TestRuntimeDefaultsClosedWithoutDependencies(t *testing.T) {
	e, err := NewRuntime(RuntimeConfig{}, nil, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	h, err := NewRuntimeHandler(RuntimeConfig{}, e)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/healthz", nil)
	r.Host = "general-beta.example.invalid"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatal("default runtime open")
	}
}
func TestRuntimeConfigRejectsUnsafeOrExtendedPolicy(t *testing.T) {
	c, _, _, clock := runtimeFixture(t)
	changes := []func(*RuntimeConfig){
		func(c *RuntimeConfig) { c.Listen = "0.0.0.0:58480" },
		func(c *RuntimeConfig) { c.UpstreamOrigin = "https://remote.example.invalid" },
		func(c *RuntimeConfig) { c.UpstreamOrigin = "http://localhost:58443" },
		func(c *RuntimeConfig) { c.UpstreamOrigin = "https://localhost:58443/path" },
		func(c *RuntimeConfig) { c.Policy.Audience = "untrusted" },
		func(c *RuntimeConfig) { c.Policy.Issuer = "http://other.example.invalid" },
		func(c *RuntimeConfig) { c.Revocation = "" },
		func(c *RuntimeConfig) { c.CAHash = "" },
		func(c *RuntimeConfig) { c.Policy.DeclarationVersion = "" },
	}
	for i, change := range changes {
		x := c
		change(&x)
		if x.Validate(clock.Now()) == nil {
			t.Fatalf("unsafe config %d accepted", i)
		}
	}
}
func TestRuntimeHTTPBoundaryUsesActualTLSAndHostNotForwardedHeaders(t *testing.T) {
	c, e, d, _ := runtimeFixture(t)
	h, err := NewRuntimeHandler(c, e)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, path, method, body string
		edit                     func(*http.Request)
		want                     int
	}{
		{"health", "/healthz", "GET", "", nil, 200},
		{"edge metadata is not authority", "/healthz", "GET", "", func(r *http.Request) {
			r.Header.Set("Cf-Connecting-Ip", "198.51.100.10")
			r.Header.Set("Cf-Ray", "fixture-edge")
			r.Header.Set("X-Forwarded-For", "198.51.100.10")
			r.Header.Set("X-Forwarded-Proto", "https")
		}, 200},
		{"no TLS", "/healthz", "GET", "", func(r *http.Request) { r.TLS = nil; r.Header.Set("X-Forwarded-Proto", "https") }, 400},
		{"wrong host", "/healthz", "GET", "", func(r *http.Request) { r.Host = "other.example.invalid" }, 400},
		{"anonymous API", "/v1/learners", "GET", "", nil, 401},
		{"admin", "/admin/users", "GET", "", nil, 400},
		{"query ambiguity", "/token?grant_type=password&grant_type=refresh_token", "POST", "{}", nil, 400},
		{"chunked", "/signup", "POST", "{}", func(r *http.Request) { r.TransferEncoding = []string{"chunked"}; r.ContentLength = -1 }, 400},
		{"duplicate auth", "/user", "GET", "", func(r *http.Request) { r.Header["Authorization"] = []string{"Bearer one", "Bearer two"} }, 400},
		{"oversized auth", "/signup", "POST", strings.Repeat("x", 16385), nil, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Host = "general-beta.example.invalid"
			r.RemoteAddr = "192.0.2.1:1234"
			r.TLS = &tls.ConnectionState{HandshakeComplete: true}
			if tc.body != "" {
				r.Header.Set("Content-Type", "application/json")
			}
			if tc.edit != nil {
				tc.edit(r)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status %d expected %d", w.Code, tc.want)
			}
			if strings.Contains(w.Body.String(), "password") {
				t.Fatal("private diagnostic leaked")
			}
		})
	}
	if len(d.p.mail) != 0 {
		t.Fatal("rejected boundary request dispatched mail")
	}
}

func TestRuntimeForwardedIdentityCannotRotateAuthenticationRateBuckets(t *testing.T) {
	c, _, f, clock := runtimeFixture(t)
	c.Policy.AuthIPMinute = 1
	e, err := NewRuntime(c, clock, f.v, f.p, f.b)
	if err != nil {
		t.Fatal(err)
	}
	h, _ := NewRuntimeHandler(c, e)
	for i, spoof := range []string{"198.51.100.1", "198.51.100.2"} {
		r := httptest.NewRequest("POST", "/token?grant_type=password", strings.NewReader(`{"email":"first@example.invalid","password":"synthetic-password-123"}`))
		r.Host = "general-beta.example.invalid"
		r.RemoteAddr = "192.0.2.1:1234"
		r.TLS = &tls.ConnectionState{HandshakeComplete: true}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Forwarded-For", spoof)
		r.Header.Set("Cf-Connecting-Ip", spoof)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 200
		if i == 1 {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("spoofed peer changed rate boundary: %d expected %d", w.Code, want)
		}
	}
}
func TestRuntimeHTTPFeedsExistingAuthenticationWithoutServiceExpiry(t *testing.T) {
	c, e, _, clock := runtimeFixture(t)
	h, _ := NewRuntimeHandler(c, e)
	body := `{"email":"first@example.invalid","password":"synthetic-password-123"}`
	r := httptest.NewRequest("POST", "/token?grant_type=password", strings.NewReader(body))
	r.Host = "general-beta.example.invalid"
	r.RemoteAddr = "192.0.2.1:1234"
	r.TLS = &tls.ConnectionState{HandshakeComplete: true}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept-Encoding", "gzip")
	r.Header.Set("Connection", "Keep-Alive")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("actual boundary authentication failed: %d", w.Code)
	}
	var out map[string]json.RawMessage
	if json.Unmarshal(w.Body.Bytes(), &out) != nil || out["access_token"] == nil {
		t.Fatal("native session codec missing")
	}
	clock.advance(time.Hour)
	if e.Handle(context.Background(), req("GET", "/healthz", "")).Status != 200 {
		t.Fatal("ordinary runtime expired")
	}
}

func TestRuntimeConfigParsingBindingStopAndServerRemainExplicit(t *testing.T) {
	c, e, _, clock := runtimeFixture(t)
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseRuntimeConfig(raw, clock.Now())
	if err != nil || parsed != c {
		t.Fatal("strict config round trip failed", err)
	}
	for _, bad := range []string{`{"Enabled":false,"Enabled":true}`, `{"enabled":true}`, `{"Enabled":null}`, `{"Policy":null}`, `{"Enabled":false,"unknown":"field"}`, string(raw) + ` {}`, `null`} {
		if _, err := ParseRuntimeConfig([]byte(bad), clock.Now()); err == nil {
			t.Fatal("ambiguous config accepted")
		}
	}
	h, err := NewRuntimeHandler(c, e)
	if err != nil {
		t.Fatal(err)
	}
	other := c
	other.Listen = "127.0.0.1:58481"
	if _, err := NewRuntimeHandler(other, e); err == nil {
		t.Fatal("handler silently rebound to another config")
	}
	if _, err := RuntimeServer(other, h, clock.Now()); err == nil {
		t.Fatal("server silently rebound to another config")
	}
	if _, err := RuntimeServer(c, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}), clock.Now()); err == nil {
		t.Fatal("unrestricted handler substituted")
	}
	s, err := RuntimeServer(c, h, clock.Now())
	if err != nil || s.Addr != c.Listen || s.TLSConfig.MinVersion < tls.VersionTLS12 || s.ReadHeaderTimeout <= 0 || s.MaxHeaderBytes > 32768 {
		t.Fatal("server safety configuration missing")
	}
	if s.TLSConfig.Certificates != nil {
		t.Fatal("server constructor loaded credentials")
	}
	e.Stop()
	if e.Handle(context.Background(), req("GET", "/healthz", "")).Status != 503 {
		t.Fatal("stop did not close gateway")
	}
}

func ordinaryPolicyFixture(p Policy) RuntimePolicy {
	return RuntimePolicy{MailEnabled: p.MailEnabled, Origin: p.Origin, Issuer: p.Issuer, Audience: p.Audience, MaxConcurrent: p.MaxConcurrent, MailGlobal: p.MailGlobal, MailRecipientHour: p.MailRecipientHour, MailIPHour: p.MailIPHour, AuthIPMinute: p.AuthIPMinute, AuthRecipientMinute: p.AuthRecipientMinute, MaxState: p.MaxState, MailCooldown: p.MailCooldown, DeclarationVersion: p.DeclarationVersion, ConsentVersion: p.ConsentVersion}
}
