package generalingress

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
)

type roundTripDouble struct {
	call  func(*http.Request) (*http.Response, error)
	calls int
}

func (*roundTripDouble) OfflineOnly() bool { return true }
func (r *roundTripDouble) RoundTrip(q *http.Request) (*http.Response, error) {
	r.calls++
	return r.call(q)
}

type detailedDouble struct {
	value auth.GoTrueSession
	err   error
}

func (*detailedDouble) OfflineOnly() bool { return true }
func (d *detailedDouble) Read(_ context.Context, token string) (auth.GoTrueSession, error) {
	if token != "a-access" {
		return auth.GoTrueSession{}, ErrDenied
	}
	return d.value, d.err
}

type authorityDouble struct {
	active bool
	err    error
}

func (*authorityDouble) OfflineOnly() bool { return true }
func (a *authorityDouble) Active(context.Context, string, string, string) (bool, error) {
	return a.active, a.err
}

type keyerDouble struct{}

func (keyerDouble) OfflineOnly() bool     { return true }
func (keyerDouble) PolicyBinding() string { return "fixture-binding" }
func (keyerDouble) Key(kind, value string) (string, error) {
	if kind == "recipient" && value == "first@example.invalid" {
		return "recipient-a", nil
	}
	if kind == "ip" && value == "192.0.2.1" {
		return "ip-a", nil
	}
	return "", ErrStorage
}

func adapterFixture(t *testing.T) (*HTTPProvider, *HTTPBackend, *roundTripDouble, *detailedDouble, *authorityDouble) {
	t.Helper()
	_, budget := newBudget(t)
	now := time.Unix(1800000000, 0)
	cert := &x509.Certificate{Raw: []byte("existing-synthetic-public-root-model-no-key")}
	sum := sha256.Sum256(cert.Raw)
	d := &detailedDouble{value: auth.GoTrueSession{Principal: auth.Principal{Issuer: origin, Subject: userA, AuthTime: now.Unix()}, SessionID: sidA, Audience: "authenticated", Role: "authenticated", Method: "password", ExpiresAt: now.Add(time.Hour)}}
	a := &authorityDouble{active: true}
	rt := &roundTripDouble{}
	rt.call = func(r *http.Request) (*http.Response, error) {
		body := `{"id":"` + userA + `","email":"first@example.invalid","email_confirmed_at":"2026-01-01T00:00:00Z","is_anonymous":false,"role":"authenticated","user_metadata":{"ignored":true},"phone":null}`
		status := 200
		switch r.URL.Path {
		case "/token", "/verify":
			body = `{"access_token":"a-access","refresh_token":"a-refresh","token_type":"bearer","expires_in":3600,"user":{"id":"` + userA + `"}}`
		case "/signup", "/recover", "/resend":
			body = `{}`
		case "/logout":
			status = 204
			body = ""
			a.active = false
		case "/v1/learners":
			body = `[{"id":"` + learnerA + `","client_learner_id":"same-native-id","kind":"ADULT","audience":"adults","lang":"id"}]`
		case "/v1/learners/" + learnerA + "/events":
			body = `{"events":[],"has_more":false,"next_cursor":0}`
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), TLS: &tls.ConnectionState{HandshakeComplete: true, ServerName: "auth-api.example.invalid", VerifiedChains: [][]*x509.Certificate{{cert}}}, Request: r}, nil
	}
	p, b, err := NewHTTPAdapters(AdapterConfig{Simulation: true, PublicOrigin: origin, UpstreamOrigin: "https://auth-api.example.invalid", CAHash: hex.EncodeToString(sum[:]), Now: func() time.Time { return now }, Revocation: RequireSessionStatus}, rt, d, a, budget, keyerDouble{})
	if err != nil {
		t.Fatal(err)
	}
	return p, b, rt, d, a
}

func TestHTTPAdaptersDefaultOffAndRevocationAuthorityRequired(t *testing.T) {
	p, _, err := NewHTTPAdapters(AdapterConfig{}, nil, nil, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Authenticate(context.Background(), AuthRequest{Grant: "password"}); err == nil {
		t.Fatal("disabled adapter usable")
	}
	p, _, rt, _, a := adapterFixture(t)
	a.active = false
	if _, err = p.Inspect(context.Background(), "a-access"); err == nil {
		t.Fatal("revoked session accepted")
	}
	p.authority = nil
	before := rt.calls
	if _, err = p.Inspect(context.Background(), "a-access"); err == nil || rt.calls != before {
		t.Fatal("missing authority used /user as revocation proof")
	}
}

func TestHTTPProviderActualJSONContractsAndDurableMail(t *testing.T) {
	p, _, rt, _, _ := adapterFixture(t)
	original := rt.call
	rt.call = func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "auth-api.example.invalid" || r.Host != "auth-api.example.invalid" || r.URL.Scheme != "https" {
			t.Error("origin drift")
		}
		if r.URL.Path == "/signup" {
			body, _ := io.ReadAll(r.Body)
			if string(body) != `{"email":"first@example.invalid","password":"synthetic-password-123"}` {
				t.Error("signup JSON drift")
			}
		}
		return original(r)
	}
	in := MailRequest{Action: "signup", Email: "first@example.invalid", Password: "synthetic-password-123", RequestID: "mail-one", Peer: "192.0.2.1"}
	if err := p.Mail(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	before := rt.calls
	if err := p.Mail(context.Background(), in); !errors.Is(err, ErrReplay) || rt.calls != before {
		t.Fatal("durable duplicate forwarded")
	}
	s, err := p.Authenticate(context.Background(), AuthRequest{Grant: "password", Email: "first@example.invalid", Password: "synthetic-password-123"})
	if err != nil || s.AccessToken != "a-access" {
		t.Fatal("session adapter failed", err)
	}
	u, err := p.Inspect(context.Background(), s.AccessToken)
	if err != nil || u.ID != userA || u.SessionID != sidA || !u.Confirmed {
		t.Fatal("user/session binding failed", err)
	}
	if err = p.Logout(context.Background(), s.AccessToken); err != nil {
		t.Fatal(err)
	}
	if _, err = p.Inspect(context.Background(), s.AccessToken); err == nil {
		t.Fatal("logout did not observe authoritative revocation")
	}
}

func TestHTTPTLSRedirectResponseAndIdentityFailures(t *testing.T) {
	for _, mode := range []string{"tls-missing", "unverified", "wrong-ca", "wrong-host", "redirect", "location", "duplicate-id", "unconfirmed", "cross-user", "oversize", "authority-error"} {
		t.Run(mode, func(t *testing.T) {
			p, _, rt, _, a := adapterFixture(t)
			orig := rt.call
			rt.call = func(r *http.Request) (*http.Response, error) {
				resp, err := orig(r)
				switch mode {
				case "tls-missing":
					resp.TLS = nil
				case "unverified":
					resp.TLS.VerifiedChains = nil
				case "wrong-ca":
					resp.TLS.VerifiedChains = [][]*x509.Certificate{{{Raw: []byte("other-public-root")}}}
				case "wrong-host":
					resp.TLS.ServerName = "other.invalid"
				case "redirect":
					resp.StatusCode = 302
					resp.Header.Set("Location", "https://elsewhere.invalid")
				case "location":
					resp.Header.Set("Location", "https://elsewhere.invalid")
				case "duplicate-id":
					resp.Body = io.NopCloser(strings.NewReader(`{"id":"` + userA + `","id":"` + userB + `"}`))
				case "unconfirmed":
					resp.Body = io.NopCloser(strings.NewReader(`{"id":"` + userA + `","email":"first@example.invalid","email_confirmed_at":null,"role":"authenticated"}`))
				case "cross-user":
					resp.Body = io.NopCloser(strings.NewReader(`{"id":"` + userB + `","email":"first@example.invalid","email_confirmed_at":"2026-01-01T00:00:00Z","role":"authenticated"}`))
				case "oversize":
					resp.Body = io.NopCloser(strings.NewReader(strings.Repeat("x", 1048577)))
				}
				return resp, err
			}
			if mode == "authority-error" {
				a.err = errors.New("private DB detail")
			}
			if _, err := p.Inspect(context.Background(), "a-access"); err == nil || strings.Contains(err.Error(), "private") {
				t.Fatal("unsafe adapter response accepted/leaked")
			}
			if mode == "redirect" && rt.calls != 1 {
				t.Fatal("redirect followed")
			}
		})
	}
}

func TestHTTPBackendForwardsExactVerifiedBearerAndOwnerUUID(t *testing.T) {
	p, b, rt, _, _ := adapterFixture(t)
	c, err := p.Verify(context.Background(), "a-access")
	if err != nil {
		t.Fatal(err)
	}
	orig := rt.call
	rt.call = func(r *http.Request) (*http.Response, error) {
		if strings.HasPrefix(r.URL.Path, "/v1/") && r.Header.Get("Authorization") != "Bearer a-access" {
			t.Error("bearer not forwarded")
		}
		return orig(r)
	}
	if _, err = b.Call(context.Background(), c, "GET", "/v1/learners/"+learnerA+"/events", nil, "a-access"); err != nil {
		t.Fatal(err)
	}
	if _, err = b.Call(context.Background(), c, "GET", "/v1/learners/"+learnerB+"/events", nil, "a-access"); err == nil {
		t.Fatal("foreign learner forwarded")
	}
	c.Subject = userB
	if _, err = b.Call(context.Background(), c, "GET", "/v1/learners", nil, "a-access"); err == nil {
		t.Fatal("caller changed owner identity")
	}
}

func TestExplicitJWTExpiryPolicyDoesNotPretendImmediateRevocation(t *testing.T) {
	p, _, _, _, a := adapterFixture(t)
	p.cfg.Revocation = AllowBoundedJWT
	p.cfg.MaxAccessWindow = 3600e9
	p.authority = nil
	if _, err := p.Inspect(context.Background(), "a-access"); err != nil {
		t.Fatal("explicit baseline JWT mode unavailable", err)
	}
	if err := p.Logout(context.Background(), "a-access"); err != nil {
		t.Fatal(err)
	}
	if a.active {
		t.Fatal("fake provider did not process logout")
	}
	if _, err := p.Inspect(context.Background(), "a-access"); err != nil {
		t.Fatal("expiry-only mode falsely claimed immediate revocation")
	}
	p.cfg.Revocation = ""
	if _, err := p.Inspect(context.Background(), "a-access"); err == nil {
		t.Fatal("unspecified revocation policy activated")
	}
}

func TestOIDCAdapterRejectsMalformedInputWithoutCreatingTokenOrNetwork(t *testing.T) {
	p, _, rt, _, _ := adapterFixture(t)
	p2, _, err := NewHTTPAdapters(p.cfg, rt, nil, p.authority, p.budget, p.keyer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p2.Verify(context.Background(), "not-a-token"); err == nil || rt.calls != 0 {
		t.Fatal("malformed token caused network/acceptance")
	}
}

func TestHTTPRecoveryGrantExpiresAndIsConsumedBeforePasswordCallback(t *testing.T) {
	p, _, rt, d, _ := adapterFixture(t)
	d.value.Method = "email/recovery"
	if _, err := p.Authenticate(context.Background(), AuthRequest{Grant: "otp", Email: "first@example.invalid", Code: "123456", Type: "recovery"}); err != nil {
		t.Fatal(err)
	}
	puts := 0
	orig := rt.call
	rt.call = func(r *http.Request) (*http.Response, error) {
		if r.Method == "PUT" {
			puts++
		}
		return orig(r)
	}
	now := p.cfg.Now()
	p.cfg.Now = func() time.Time { return now.Add(6 * time.Minute) }
	if _, err := p.UpdatePassword(context.Background(), "a-access", "another-synthetic-password"); err == nil || puts != 0 {
		t.Fatal("stale recovery forwarded password change")
	}
}
