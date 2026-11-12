package generalingress

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
)

var ErrUnavailable = errors.New("dependency unavailable")

type OfflineRoundTripper interface {
	http.RoundTripper
	OfflineOnly() bool
}
type SessionReader interface {
	OfflineOnly() bool
	Read(context.Context, string) (auth.GoTrueSession, error)
}
type SessionAuthority interface {
	OfflineOnly() bool
	Active(context.Context, string, string, string) (bool, error)
}
type IdentityKeyer interface {
	OfflineOnly() bool
	PolicyBinding() string
	Key(string, string) (string, error)
}
type RevocationMode string

const RequireSessionStatus RevocationMode = "immediate-session-status"
const AllowBoundedJWT RevocationMode = "bounded-jwt-expiry"

type AdapterConfig struct {
	Simulation                           bool
	PublicOrigin, UpstreamOrigin, CAHash string
	Issuer                               string
	Now                                  func() time.Time
	DeclarationVersion, ConsentVersion   string
	Revocation                           RevocationMode
	MaxAccessWindow                      time.Duration
}
type HTTPProvider struct {
	runtime   bool
	cfg       AdapterConfig
	client    *http.Client
	reader    SessionReader
	authority SessionAuthority
	budget    *Budget
	mailGate  *mailAdmission
	keyer     IdentityKeyer
	mu        sync.Mutex
	recovery  map[[32]byte]bool
}
type HTTPBackend struct{ p *HTTPProvider }
type oidcReader struct{ v *auth.Verifier }

func (*oidcReader) OfflineOnly() bool { return true }
func (r *oidcReader) Read(ctx context.Context, token string) (auth.GoTrueSession, error) {
	return r.v.VerifyGoTrueSession(ctx, token)
}
func (p *HTTPProvider) OfflineOnly() bool { return !p.runtime }
func (b *HTTPBackend) OfflineOnly() bool  { return !b.p.runtime }

func invalidOrigin(raw string) bool {
	u, e := url.Parse(raw)
	return e == nil && u.Scheme == "https" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && u.Host == u.Hostname() && strings.HasSuffix(u.Hostname(), ".invalid")
}
func NewHTTPAdapters(c AdapterConfig, transport OfflineRoundTripper, reader SessionReader, authority SessionAuthority, budget *Budget, keyer IdentityKeyer) (*HTTPProvider, *HTTPBackend, error) {
	p := &HTTPProvider{cfg: c, reader: reader, authority: authority, budget: budget, keyer: keyer, recovery: map[[32]byte]bool{}}
	b := &HTTPBackend{p: p}
	if !c.Simulation {
		return p, b, nil
	}
	pin, e := hex.DecodeString(c.CAHash)
	if !invalidOrigin(c.PublicOrigin) || !invalidOrigin(c.UpstreamOrigin) || c.Issuer != "" && c.Issuer != c.PublicOrigin || e != nil || len(pin) != 32 || c.Now == nil || transport == nil || !transport.OfflineOnly() || reader != nil && !reader.OfflineOnly() || authority != nil && !authority.OfflineOnly() || keyer != nil && !keyer.OfflineOnly() || c.Revocation != RequireSessionStatus && c.Revocation != AllowBoundedJWT || c.Revocation == AllowBoundedJWT && (c.MaxAccessWindow <= 0 || c.MaxAccessWindow > time.Hour) {
		return nil, nil, ErrUnavailable
	}
	u, _ := url.Parse(c.UpstreamOrigin)
	p.client = &http.Client{Transport: &guardedTransport{base: transport, origin: c.UpstreamOrigin, host: u.Host, pin: c.CAHash}, Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if reader == nil {
		v, e := auth.NewWithClient(context.Background(), auth.Config{Provider: "gotrue", Issuer: c.PublicOrigin, JWKSURL: c.UpstreamOrigin + "/.well-known/jwks.json", Audience: "authenticated"}, p.client)
		if e != nil {
			return nil, nil, ErrUnavailable
		}
		p.reader = &oidcReader{v: v}
	}
	return p, b, nil
}

type guardedTransport struct {
	base              http.RoundTripper
	origin, host, pin string
	tlsName           string
}

func (g *guardedTransport) CloseIdleConnections() {
	if c, ok := g.base.(interface{ CloseIdleConnections() }); ok {
		c.CloseIdleConnections()
	}
}

func (g *guardedTransport) RoundTrip(q *http.Request) (*http.Response, error) {
	if q.URL == nil || q.URL.Scheme+"://"+q.URL.Host != g.origin || q.URL.User != nil || q.URL.Fragment != "" || q.Host != "" && q.Host != g.host {
		return nil, ErrUnavailable
	}
	copy := q.Clone(q.Context())
	copy.Host = g.host
	resp, err := g.base.RoundTrip(copy)
	if err != nil {
		return nil, ErrUnavailable
	}
	fail := func() (*http.Response, error) {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		return nil, ErrUnavailable
	}
	name := g.tlsName
	if name == "" {
		name = g.host
	}
	if resp == nil || resp.Body == nil || resp.TLS == nil || !resp.TLS.HandshakeComplete || resp.TLS.ServerName != name || len(resp.TLS.VerifiedChains) == 0 {
		return fail()
	}
	pinned := false
	for _, chain := range resp.TLS.VerifiedChains {
		if len(chain) > 0 && chain[len(chain)-1] != nil {
			sum := sha256.Sum256(chain[len(chain)-1].Raw)
			if hex.EncodeToString(sum[:]) == g.pin {
				pinned = true
			}
		}
	}
	if !pinned || resp.StatusCode >= 300 && resp.StatusCode < 400 || resp.Header.Get("Location") != "" || resp.Header.Get("Content-Encoding") != "" {
		return fail()
	}
	return resp, nil
}

func object(raw []byte) (map[string]json.RawMessage, error) {
	if !utf8.Valid(raw) || native.ValidateDocument(raw) != nil {
		return nil, ErrUnavailable
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return nil, ErrUnavailable
	}
	for k := range m {
		for _, canonical := range []string{"id", "email", "email_confirmed_at", "is_anonymous", "role", "access_token", "refresh_token", "token_type", "expires_in", "user"} {
			if strings.EqualFold(k, canonical) && k != canonical {
				return nil, ErrUnavailable
			}
		}
	}
	return m, nil
}
func text(m map[string]json.RawMessage, k string) string {
	var s string
	json.Unmarshal(m[k], &s)
	return s
}
func (p *HTTPProvider) ready() bool {
	return p != nil && (p.cfg.Simulation || p.runtime) && p.client != nil && p.reader != nil && (p.cfg.Revocation == RequireSessionStatus || p.cfg.Revocation == AllowBoundedJWT && p.cfg.MaxAccessWindow > 0 && p.cfg.MaxAccessWindow <= time.Hour)
}
func bearer(token string) bool {
	return len(token) > 0 && len(token) <= 16384 && ascii(token) && !strings.Contains(token, " ")
}
func (p *HTTPProvider) request(ctx context.Context, method, target string, body any, token string) ([]byte, error) {
	if !p.ready() || token != "" && !bearer(token) || !strings.HasPrefix(target, "/") || strings.ContainsAny(target, "#%\\") {
		return nil, ErrUnavailable
	}
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil || len(raw) > requestBodyLimit(method, target) {
			return nil, ErrUnavailable
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, p.cfg.UpstreamOrigin+target, bytes.NewReader(raw))
	if err != nil {
		return nil, ErrUnavailable
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 {
		return nil, &rateFailure{seconds: retrySeconds(resp.Header)}
	}
	if resp.StatusCode == 204 {
		return nil, nil
	}
	if strings.Split(resp.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return nil, ErrUnavailable
	}
	out, err := io.ReadAll(io.LimitReader(resp.Body, 1048577))
	if err != nil || len(out) > 1048576 || !utf8.Valid(out) || native.ValidateDocument(out) != nil {
		return nil, ErrUnavailable
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		// Forward only documented, non-sensitive action codes, never arbitrary
		// provider messages, headers, response bodies or redirects.
		var fields map[string]json.RawMessage
		if json.Unmarshal(out, &fields) != nil {
			return nil, ErrUnavailable
		}
		var code string
		if json.Unmarshal(fields["error_code"], &code) != nil {
			_ = json.Unmarshal(fields["error"], &code)
		}
		allowed := map[string]int{"sync_consent_required": 403, "sync_consent_update_required": 403, "adult_owner_required": 403, "fresh_auth_required": 403, "fresh_authentication_required": 403, "not_found": 404, "idempotency_conflict": 409, "dependent_learners": 409, "server_copy_deleted": 410, "account_deleted": 410, "account_erasure_unavailable": 503, "invalid_request": 400, "invalid_native_event": 400, "invalid_reference": 400, "email_not_confirmed": 400, "invalid_credentials": 401, "invalid_otp": 401, "invalid_refresh_token": 401, "unauthorized": 401}
		if allowed[code] == resp.StatusCode {
			return nil, &wireFailure{resp.StatusCode, code}
		}
		if resp.StatusCode == 400 || resp.StatusCode == 401 || resp.StatusCode == 403 {
			if target == "/signup" || target == "/resend" || target == "/recover" {
				return nil, &providerRejection{resp.StatusCode}
			}
			return nil, ErrDenied
		}
		return nil, ErrUnavailable
	}
	return out, nil
}

type wireFailure struct {
	status int
	code   string
}

func (e *wireFailure) Error() string { return "upstream action refused" }
func (e *wireFailure) Unwrap() error { return ErrDenied }
func (p *HTTPProvider) expectedIssuer() string {
	if p.cfg.Issuer != "" {
		return p.cfg.Issuer
	}
	return p.cfg.PublicOrigin
}

func (p *HTTPProvider) Verify(ctx context.Context, token string) (Claims, error) {
	if !p.ready() || !bearer(token) {
		return Claims{}, ErrDenied
	}
	d, err := p.reader.Read(ctx, token)
	if err != nil || d.Principal.Issuer != p.expectedIssuer() || d.Audience != "authenticated" || !uuid.MatchString(d.Principal.Subject) || !uuid.MatchString(d.SessionID) || d.Role != "authenticated" || d.Anonymous || !d.ExpiresAt.After(p.cfg.Now()) {
		return Claims{}, ErrDenied
	}
	return Claims{Issuer: d.Principal.Issuer, Audience: d.Audience, Subject: d.Principal.Subject, SessionID: d.SessionID, Role: d.Role, Method: d.Method, ExpiresAt: d.ExpiresAt, AuthTime: time.Unix(d.Principal.AuthTime, 0)}, nil
}
func (p *HTTPProvider) Inspect(ctx context.Context, token string) (User, error) {
	c, err := p.Verify(ctx, token)
	if err != nil {
		return User{}, err
	}
	if p.cfg.Revocation == RequireSessionStatus {
		if p.authority == nil {
			return User{}, ErrUnavailable
		}
		active, err := p.authority.Active(ctx, c.Issuer, c.Subject, c.SessionID)
		if err != nil {
			return User{}, ErrUnavailable
		}
		if !active {
			return User{}, ErrDenied
		}
	} else if c.ExpiresAt.Sub(p.cfg.Now()) > p.cfg.MaxAccessWindow {
		return User{}, ErrDenied
	}
	raw, err := p.request(ctx, "GET", "/user", nil, token)
	if err != nil {
		return User{}, err
	}
	m, err := object(raw)
	if err != nil {
		return User{}, err
	}
	mail, valid := email(text(m, "email"))
	var anonymous bool
	if v, ok := m["is_anonymous"]; ok && json.Unmarshal(v, &anonymous) != nil {
		return User{}, ErrUnavailable
	}
	confirmed, err := time.Parse(time.RFC3339, text(m, "email_confirmed_at"))
	if err != nil || confirmed.After(p.cfg.Now()) || !valid || text(m, "id") != c.Subject || text(m, "role") != "authenticated" || anonymous {
		return User{}, ErrDenied
	}
	return User{ID: c.Subject, SessionID: c.SessionID, Email: mail, Confirmed: true, ConfirmedAt: text(m, "email_confirmed_at")}, nil
}
func (p *HTTPProvider) Authenticate(ctx context.Context, a AuthRequest) (Session, error) {
	if !p.ready() {
		return Session{}, ErrUnavailable
	}
	path := ""
	body := map[string]string{}
	switch a.Grant {
	case "password":
		e, ok := email(a.Email)
		if !ok || !password(a.Password) {
			return Session{}, ErrDenied
		}
		path = "/token?grant_type=password"
		body = map[string]string{"email": e, "password": a.Password}
	case "refresh_token":
		if len(a.RefreshToken) < 1 || len(a.RefreshToken) > 4096 || !bearer(a.RefreshToken) {
			return Session{}, ErrDenied
		}
		path = "/token?grant_type=refresh_token"
		body = map[string]string{"refresh_token": a.RefreshToken}
	case "otp":
		e, ok := email(a.Email)
		if !ok || !otpCode.MatchString(a.Code) || (a.Type != "signup" && a.Type != "recovery") {
			return Session{}, ErrDenied
		}
		path = "/verify"
		body = map[string]string{"email": e, "token": a.Code, "type": a.Type}
	default:
		return Session{}, ErrDenied
	}
	raw, err := p.request(ctx, "POST", path, body, "")
	if err != nil {
		return Session{}, err
	}
	m, err := object(raw)
	if err != nil {
		return Session{}, err
	}
	s := Session{AccessToken: text(m, "access_token"), RefreshToken: text(m, "refresh_token")}
	var expiry int64
	if !bearer(s.AccessToken) || !bearer(s.RefreshToken) || len(s.RefreshToken) > 4096 || text(m, "token_type") != "bearer" || json.Unmarshal(m["expires_in"], &expiry) != nil || expiry < 1 || expiry > 86400 {
		return Session{}, ErrUnavailable
	}
	u, err := p.Inspect(ctx, s.AccessToken)
	if err != nil {
		return Session{}, err
	}
	returned, err := object(m["user"])
	if err != nil || text(returned, "id") != u.ID || a.Email != "" && !strings.EqualFold(a.Email, u.Email) {
		return Session{}, ErrDenied
	}
	if !p.runtime && a.Grant == "otp" && a.Type == "recovery" {
		c, err := p.Verify(ctx, s.AccessToken)
		if err != nil || (c.Method != "otp" && c.Method != "email/recovery") || p.cfg.Now().Sub(c.AuthTime) > 5*time.Minute {
			return Session{}, ErrDenied
		}
		p.mu.Lock()
		p.recovery[sha256.Sum256([]byte(s.AccessToken))] = true
		p.mu.Unlock()
	}
	return s, nil
}
func (p *HTTPProvider) Mail(ctx context.Context, in MailRequest) error {
	if !p.ready() || (p.mailGate == nil && (p.budget == nil || p.keyer == nil || p.budget.policy.IdentityBinding != p.keyer.PolicyBinding())) {
		return ErrUnavailable
	}
	e, ok := email(in.Email)
	if !ok {
		return ErrDenied
	}
	body := map[string]string{"email": e}
	switch in.Action {
	case "signup":
		if !password(in.Password) {
			return ErrDenied
		}
		body["password"] = in.Password
	case "resend":
		body["type"] = "signup"
	case "recover":
	default:
		return ErrDenied
	}
	if p.mailGate != nil {
		peer := net.ParseIP(in.Peer)
		if !native.ID(in.RequestID) || peer == nil {
			return ErrDenied
		}
		if ctx.Err() != nil {
			return ErrUnavailable
		}
		raw, _ := json.Marshal(struct{ Action, Origin, Email, Password string }{in.Action, p.cfg.PublicOrigin, e, in.Password})
		fingerprint := sha256.Sum256(raw)
		clear(raw)
		recipient := sha256.Sum256([]byte("recipient:" + e))
		peerID := sha256.Sum256([]byte("ip:" + peer.String()))
		if err := p.mailGate.reserve(in.RequestID, fingerprint, recipient, peerID); err != nil {
			return err
		}
		_, err := p.request(ctx, "POST", "/"+in.Action, body, "")
		p.mailGate.complete(in.RequestID, err)
		return err
	}
	recipient, err := p.keyer.Key("recipient", e)
	if err != nil {
		return ErrStorage
	}
	ip, err := p.keyer.Key("ip", in.Peer)
	if err != nil {
		return ErrStorage
	}
	if err = p.budget.Reserve(ctx, in.RequestID, recipient, ip, p.cfg.Now()); err != nil {
		return err
	}
	_, err = p.request(ctx, "POST", "/"+in.Action, body, "")
	return err
}
func (p *HTTPProvider) Logout(ctx context.Context, token string) error {
	u, err := p.Inspect(ctx, token)
	if err != nil {
		return err
	}
	if _, err = p.request(ctx, "POST", "/logout?scope=local", nil, token); err != nil {
		return err
	}
	if p.cfg.Revocation == RequireSessionStatus {
		active, err := p.authority.Active(ctx, p.expectedIssuer(), u.ID, u.SessionID)
		if err != nil || active {
			return ErrUnavailable
		}
	}
	return nil
}
func (p *HTTPProvider) UpdatePassword(ctx context.Context, token, passwordValue string) (User, error) {
	if !password(passwordValue) {
		return User{}, ErrDenied
	}
	c, err := p.Verify(ctx, token)
	if err != nil || (c.Method != "otp" && c.Method != "email/recovery") || c.AuthTime.IsZero() || p.cfg.Now().Sub(c.AuthTime) < -5*time.Second || p.cfg.Now().Sub(c.AuthTime) > 5*time.Minute {
		return User{}, ErrDenied
	}
	u, err := p.Inspect(ctx, token)
	if err != nil {
		return User{}, err
	}
	if !p.runtime {
		h := sha256.Sum256([]byte(token))
		p.mu.Lock()
		allowed := p.recovery[h]
		delete(p.recovery, h)
		p.mu.Unlock()
		if !allowed {
			return User{}, ErrDenied
		}
	}
	raw, err := p.request(ctx, "PUT", "/user", map[string]string{"password": passwordValue}, token)
	if err != nil {
		return User{}, err
	}
	m, err := object(raw)
	if err != nil || text(m, "id") != u.ID {
		return User{}, ErrUnavailable
	}
	return u, nil
}
func (b *HTTPBackend) bound(ctx context.Context, c Claims, token string) error {
	u, err := b.p.Inspect(ctx, token)
	if err != nil {
		return err
	}
	actual, err := b.p.Verify(ctx, token)
	if err != nil || c.Issuer != actual.Issuer || c.Subject != u.ID || c.SessionID != u.SessionID {
		return ErrDenied
	}
	return nil
}
func (b *HTTPBackend) Owns(ctx context.Context, c Claims, id, token string) (bool, error) {
	if !uuid.MatchString(id) || b.bound(ctx, c, token) != nil {
		return false, ErrDenied
	}
	raw, err := b.p.request(ctx, "GET", "/v1/learners", nil, token)
	if err != nil {
		return false, err
	}
	var rows []json.RawMessage
	if json.Unmarshal(raw, &rows) != nil || len(rows) > 10000 {
		return false, ErrUnavailable
	}
	found := false
	seen := map[string]bool{}
	for _, row := range rows {
		m, err := object(row)
		if err != nil {
			return false, err
		}
		learner := text(m, "id")
		if !uuid.MatchString(learner) || seen[learner] {
			return false, ErrUnavailable
		}
		seen[learner] = true
		if learner == id {
			found = true
		}
	}
	return found, nil
}
func (b *HTTPBackend) Call(ctx context.Context, c Claims, method, target string, body []byte, token string) (any, error) {
	if b.bound(ctx, c, token) != nil {
		return nil, ErrDenied
	}
	u, _ := url.Parse(b.p.cfg.PublicOrigin)
	headers := [][2]string{{"Host", u.Host}, {"Authorization", "Bearer " + token}}
	if len(body) > 0 {
		headers = append(headers, [2]string{"Content-Type", "application/json"})
	}
	r := Request{Method: method, Target: target, Body: body, TLS: true, Peer: "127.0.0.1", Headers: headers}
	parsed, err := parse(r, u.Host, Policy{DeclarationVersion: b.p.cfg.DeclarationVersion, ConsentVersion: b.p.cfg.ConsentVersion})
	if err != nil || !strings.HasPrefix(parsed.path, "/v1/") {
		return nil, ErrDenied
	}
	// Erasure retries are authorized by the backend receipt, even after the learner is gone.
	if parsed.learner != "" && !strings.HasSuffix(parsed.path, "/deletion") {
		owned, err := b.Owns(ctx, c, parsed.learner, token)
		if err != nil {
			return nil, err
		}
		if !owned {
			return nil, ErrDenied
		}
	}
	var payload any
	if len(body) > 0 {
		if json.Unmarshal(body, &payload) != nil {
			return nil, ErrDenied
		}
	}
	raw, err := b.p.request(ctx, method, target, payload, token)
	if err != nil {
		return nil, err
	}
	if target == accountDeletionPath {
		var in struct {
			RequestID string `json:"request_id"`
		}
		if json.Unmarshal(body, &in) != nil {
			return nil, ErrUnavailable
		}
		return accountReceipt(raw, in.RequestID)
	}
	var result any
	if json.Unmarshal(raw, &result) != nil {
		return nil, ErrUnavailable
	}
	return result, nil
}
