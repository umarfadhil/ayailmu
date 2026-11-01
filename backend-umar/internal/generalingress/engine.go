package generalingress

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
)

type binding struct {
	claims          Claims
	access, refresh [32]byte
	active          bool
	recoveryUntil   time.Time
}
type Engine struct {
	mu, countsMu          sync.Mutex
	p                     Policy
	clock                 Clock
	verifier              Verifier
	provider              Provider
	backend               Backend
	host                  string
	slots                 chan struct{}
	created, lastWall     time.Time
	initialMono, lastMono time.Duration
	halted                bool
	runtime               bool // set only by the separately validated runtime constructor
	runtimeConfig         *RuntimeConfig
	sessions              map[string]*binding
	refresh               map[[32]byte]string
	operations, otps      map[string]bool
	windows               map[string][]time.Time
	lastMail              map[string]time.Time
	reserved              int
	counts                map[string]int
}

func newEngineState(p Policy, c Clock, v Verifier, a Provider, b Backend) *Engine {
	return &Engine{p: p, clock: c, verifier: v, provider: a, backend: b, slots: make(chan struct{}, 1), sessions: map[string]*binding{}, refresh: map[[32]byte]string{}, operations: map[string]bool{}, otps: map[string]bool{}, windows: map[string][]time.Time{}, lastMail: map[string]time.Time{}, counts: map[string]int{}}
}
func New(p Policy, c Clock, v Verifier, a Provider, b Backend) (*Engine, error) {
	e := newEngineState(p, c, v, a, b)
	if !p.Simulation {
		if p.MailEnabled {
			return nil, errors.New("mail requires offline simulation")
		}
		return e, nil
	}
	u, err := url.Parse(p.Origin)
	if err != nil || u.Scheme != "https" || !strings.HasSuffix(u.Hostname(), ".invalid") || u.Host != u.Hostname() || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || p.Issuer != p.Origin || p.Audience != "authenticated" || c == nil || v == nil || a == nil || b == nil || !v.OfflineOnly() || !a.OfflineOnly() || !b.OfflineOnly() {
		return nil, errors.New("offline policy/dependency mismatch")
	}
	e.created = c.Now()
	e.lastWall = e.created
	e.initialMono = c.Elapsed()
	e.lastMono = e.initialMono
	if p.Deadline.Sub(e.created) <= 0 || p.Deadline.Sub(e.created) > 24*time.Hour || p.MaxConcurrent < 1 || p.MaxConcurrent > 4 || p.MaxState < 1 || p.MaxState > 10000 || p.AuthIPMinute < 1 || p.AuthRecipientMinute < 1 || p.MailGlobal < 1 || p.MailRecipientHour < 1 || p.MailIPHour < 1 || p.MailCooldown < time.Second {
		return nil, errors.New("invalid bounded simulation policy")
	}
	e.host = u.Host
	e.slots = make(chan struct{}, p.MaxConcurrent)
	return e, nil
}

func result(status int, code string) Response { return Response{Status: status, Code: code} }
func (e *Engine) count(status int) {
	e.countsMu.Lock()
	defer e.countsMu.Unlock()
	e.counts[fmt.Sprintf("status_%d", status)]++
}
func (e *Engine) Counters() map[string]int {
	e.countsMu.Lock()
	defer e.countsMu.Unlock()
	out := map[string]int{}
	for k, v := range e.counts {
		out[k] = v
	}
	return out
}
func (e *Engine) Snapshot() Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	n := 0
	for _, b := range e.sessions {
		if b.active {
			n++
		}
	}
	return Snapshot{e.reserved, n, e.halted}
}

func (e *Engine) halt() {
	e.halted = true
	for _, b := range e.sessions {
		b.active = false
	}
	e.refresh = map[[32]byte]string{}
}
func (e *Engine) live() bool {
	if e.runtime {
		return !e.halted
	}
	if !(e.p.Simulation || e.runtime) || e.halted {
		return false
	}
	now, mono := e.clock.Now(), e.clock.Elapsed()
	if now.Before(e.lastWall) || mono < e.lastMono || !now.Before(e.p.Deadline) || mono-e.initialMono >= e.p.Deadline.Sub(e.created) {
		e.halt()
		return false
	}
	e.lastWall, e.lastMono = now, mono
	return true
}

func (e *Engine) Handle(ctx context.Context, r Request) (out Response) {
	select {
	case e.slots <- struct{}{}:
		defer func() { <-e.slots }()
	default:
		e.count(429)
		return result(429, "busy")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	defer func() {
		if recover() != nil {
			e.halt()
			out = result(503, "unavailable")
		}
		e.count(out.Status)
	}()
	if !e.live() || ctx.Err() != nil {
		return result(503, "unavailable")
	}
	p, err := parse(r, e.host, e.p)
	if err != nil {
		return result(400, "invalid_request")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out = e.dispatch(ctx, r, p)
	if !e.live() || ctx.Err() != nil {
		return result(503, "unavailable")
	}
	return out
}

func (e *Engine) allowed(key string, limit int, d time.Duration) bool {
	now := e.clock.Now()
	if e.runtime && len(e.windows) >= e.p.MaxState {
		for k, window := range e.windows {
			if len(window) == 0 || now.Sub(window[len(window)-1]) >= time.Minute {
				delete(e.windows, k)
			}
		}
	}
	window := e.windows[key]
	kept := window[:0]
	for _, at := range window {
		if now.Sub(at) < d {
			kept = append(kept, at)
		}
	}
	if len(kept) >= limit {
		return false
	}
	if _, exists := e.windows[key]; !exists && len(e.windows) >= e.p.MaxState*4 {
		e.halt()
		return false
	}
	e.windows[key] = append(kept, now)
	return true
}
func (e *Engine) dispatch(ctx context.Context, r Request, p parsed) Response {
	if p.path == "/healthz" {
		return result(200, "ok")
	}
	if p.path == "/signup" || p.path == "/resend" || p.path == "/recover" {
		return e.mail(ctx, r, p)
	}
	if p.grant != "" || p.path == "/verify" {
		if !e.allowed("auth-ip:"+r.Peer, e.p.AuthIPMinute, time.Minute) {
			return result(429, "retry_later")
		}
	}
	if p.auth.Email != "" {
		if !e.allowed("auth-recipient:"+p.auth.Email, e.p.AuthRecipientMinute, time.Minute) {
			return result(429, "retry_later")
		}
	}
	if p.grant == "password" || p.path == "/verify" {
		if p.path == "/verify" && !e.runtime {
			key := p.auth.Email + "|" + p.auth.Type + "|" + p.auth.Code
			if e.otps[key] {
				return result(401, "unauthorized")
			}
			if len(e.otps) >= e.p.MaxState {
				return result(503, "unavailable")
			}
			e.otps[key] = true
		}
		s, err := e.provider.Authenticate(ctx, p.auth)
		if err != nil {
			if r, ok := explicitMailFailure(err); ok && r.Status == 429 {
				return r
			}
			var failure *wireFailure
			if errors.As(err, &failure) && failure.code == "email_not_confirmed" {
				return result(400, failure.code)
			}
			if errors.Is(err, ErrDenied) {
				return result(401, "unauthorized")
			}
			return result(503, "unavailable")
		}
		c, u, err := e.check(ctx, s.AccessToken)
		if err != nil || s.Redirect != "" || p.auth.Email != strings.ToLower(u.Email) {
			return result(401, "unauthorized")
		}
		recovery := p.path == "/verify" && p.auth.Type == "recovery"
		if p.grant == "password" && c.Method != "password" || p.path == "/verify" && p.auth.Type == "signup" && c.Method != "otp" && c.Method != "email/signup" {
			return result(401, "unauthorized")
		}
		if recovery && (c.Method != "email/recovery" && c.Method != "otp" || c.AuthTime.IsZero() || e.clock.Now().Sub(c.AuthTime) > 5*time.Minute) {
			return result(401, "unauthorized")
		}
		return e.bind(s, c, u, recovery)
	}
	if p.grant == "refresh_token" {
		if e.runtime {
			// The opaque refresh credential belongs to GoTrue. Verify its
			// returned signed identity; do not invent a proxy-side session issuer.
			s, err := e.provider.Authenticate(ctx, p.auth)
			if err != nil {
				if errors.Is(err, ErrDenied) {
					return result(401, "unauthorized")
				}
				return result(503, "unavailable")
			}
			c, u, err := e.check(ctx, s.AccessToken)
			if err != nil || s.Redirect != "" {
				return result(401, "unauthorized")
			}
			return e.bind(s, c, u, false)
		}
		hash := sha256.Sum256([]byte(p.auth.RefreshToken))
		sid, ok := e.refresh[hash]
		if !ok {
			return result(401, "unauthorized")
		}
		old := e.sessions[sid]
		delete(e.refresh, hash)
		if old == nil || !old.active || old.refresh != hash {
			return result(401, "unauthorized")
		}
		old.active = false
		s, err := e.provider.Authenticate(ctx, p.auth)
		if err != nil {
			return result(503, "unavailable")
		}
		c, u, err := e.check(ctx, s.AccessToken)
		if err != nil || s.Redirect != "" || c.Subject != old.claims.Subject || c.Issuer != old.claims.Issuer || c.SessionID != sid || sha256.Sum256([]byte(s.RefreshToken)) == hash {
			return result(401, "unauthorized")
		}
		return e.bind(s, c, u, false)
	}
	c, u, b, err := e.authorized(ctx, p.access)
	if err != nil {
		return result(401, "unauthorized")
	}
	if p.path == "/user" {
		if r.Method == "GET" {
			return Response{Status: 200, Code: "ok", User: &u}
		}
		if b.recoveryUntil.IsZero() || !e.clock.Now().Before(b.recoveryUntil) {
			return result(403, "recovery_required")
		}
		b.recoveryUntil = time.Time{}
		for _, session := range e.sessions {
			if session.claims.Issuer == c.Issuer && session.claims.Subject == c.Subject {
				session.active = false
				delete(e.refresh, session.refresh)
			}
		}
		updated, err := e.provider.UpdatePassword(ctx, p.access, p.auth.Password)
		if err != nil || updated.ID != c.Subject || updated.SessionID != c.SessionID || !updated.Confirmed || updated.Anonymous || updated.Revoked {
			return result(503, "unavailable")
		}
		return Response{Status: 200, Code: "sign_in_again", User: &updated}
	}
	if p.path == "/logout" {
		b.active = false
		delete(e.refresh, b.refresh)
		if e.provider.Logout(ctx, p.access) != nil {
			return result(503, "unavailable")
		}
		return result(204, "signed_out")
	}
	if p.learner != "" {
		owned, err := e.backend.Owns(ctx, c, p.learner, p.access)
		if err != nil {
			return result(503, "unavailable")
		}
		if !owned {
			return result(404, "not_found")
		}
	}
	if r.Method == "POST" && p.path != "" && !strings.HasSuffix(p.path, "/events") && (c.AuthTime.IsZero() || e.clock.Now().Sub(c.AuthTime) > 5*time.Minute) {
		return result(403, "fresh_auth_required")
	}
	data, err := e.backend.Call(ctx, c, r.Method, r.Target, r.Body, p.access)
	if err != nil {
		var failure *wireFailure
		if errors.As(err, &failure) {
			return result(failure.status, failure.code)
		}
		return result(503, "unavailable")
	}
	return Response{Status: 200, Code: "ok", Data: data}
}

func (e *Engine) check(ctx context.Context, token string) (Claims, User, error) {
	deny := errors.New("invalid identity")
	c, err := e.verifier.Verify(ctx, token)
	if err != nil || len(token) == 0 || len(token) > 16384 || c.Issuer != e.p.Issuer || c.Audience != e.p.Audience || !uuid.MatchString(c.Subject) || !uuid.MatchString(c.SessionID) || c.Role != "authenticated" || c.Anonymous || !c.ExpiresAt.After(e.clock.Now()) || c.AuthTime.After(e.clock.Now().Add(5*time.Second)) {
		return Claims{}, User{}, deny
	}
	u, err := e.provider.Inspect(ctx, token)
	_, validEmail := email(u.Email)
	if err != nil || !validEmail || u.ID != c.Subject || u.SessionID != c.SessionID || !u.Confirmed || u.Anonymous || u.Revoked {
		return Claims{}, User{}, deny
	}
	return c, u, nil
}
func (e *Engine) bind(s Session, c Claims, u User, recovery bool) Response {
	if len(s.RefreshToken) < 1 || len(s.RefreshToken) > 4096 || !ascii(s.RefreshToken) || strings.Contains(s.RefreshToken, " ") {
		return result(401, "unauthorized")
	}
	if e.runtime {
		return Response{Status: 200, Code: "ok", Session: &s, User: &u, ExpiresIn: int64(c.ExpiresAt.Sub(e.clock.Now()) / time.Second)}
	}
	if old := e.sessions[c.SessionID]; old != nil && (old.claims.Subject != c.Subject || old.claims.Issuer != c.Issuer) {
		return result(401, "unauthorized")
	}
	if _, exists := e.sessions[c.SessionID]; !exists && len(e.sessions) >= e.p.MaxState {
		return result(503, "unavailable")
	}
	h := sha256.Sum256([]byte(s.RefreshToken))
	if prior, exists := e.refresh[h]; exists && prior != c.SessionID {
		return result(401, "unauthorized")
	}
	if old := e.sessions[c.SessionID]; old != nil {
		delete(e.refresh, old.refresh)
	}
	b := &binding{claims: c, access: sha256.Sum256([]byte(s.AccessToken)), refresh: h, active: true}
	if recovery {
		b.recoveryUntil = e.clock.Now().Add(5 * time.Minute)
	}
	e.sessions[c.SessionID] = b
	e.refresh[h] = c.SessionID
	return Response{Status: 200, Code: "ok", Session: &s, User: &u, ExpiresIn: int64(c.ExpiresAt.Sub(e.clock.Now()) / time.Second)}
}
func (e *Engine) authorized(ctx context.Context, token string) (Claims, User, *binding, error) {
	c, u, err := e.check(ctx, token)
	if err != nil {
		return c, u, nil, err
	}
	if e.runtime {
		b := &binding{claims: c, active: true}
		// Only a fresh provider-signed OTP/recovery authentication may
		// authorize this password-only route; the provider owns session use.
		if (c.Method == "otp" || c.Method == "email/recovery") && !c.AuthTime.IsZero() {
			b.recoveryUntil = c.AuthTime.Add(5 * time.Minute)
		}
		return c, u, b, nil
	}
	b := e.sessions[c.SessionID]
	if b == nil || !b.active || b.access != sha256.Sum256([]byte(token)) || b.claims.Subject != c.Subject || b.claims.Issuer != c.Issuer {
		return Claims{}, User{}, nil, errors.New("unbound session")
	}
	return c, u, b, nil
}
func (e *Engine) mail(ctx context.Context, r Request, p parsed) Response {
	if !e.p.MailEnabled {
		return result(503, "mail_unavailable")
	}
	if e.runtime {
		// The provider owns sending policy; optional explicit durable accounting
		// remains supported. Ordinary replay admission is bounded and transient.
		err := e.provider.Mail(ctx, MailRequest{Action: strings.TrimPrefix(p.path, "/"), Email: p.auth.Email, Password: p.auth.Password, RequestID: p.operation, Peer: r.Peer})
		if r, ok := explicitMailFailure(err); ok {
			return r
		}
		if errors.Is(err, ErrReplay) {
			return result(409, "request_already_attempted")
		}
		if errors.Is(err, ErrBudget) {
			return result(429, "retry_later")
		}
		if err != nil {
			return result(503, "mail_outcome_unknown")
		}
		return result(202, "confirmation_or_recovery_requested")
	}
	if e.operations[p.operation] {
		return result(409, "request_already_attempted")
	}
	if len(e.operations) >= e.p.MaxState {
		return result(503, "unavailable")
	}
	if e.reserved >= e.p.MailGlobal {
		return result(429, "retry_later")
	}
	now := e.clock.Now()
	if at, ok := e.lastMail[p.auth.Email]; ok && now.Sub(at) < e.p.MailCooldown {
		return result(429, "retry_later")
	}
	if !e.allowed("mail-recipient:"+p.auth.Email, e.p.MailRecipientHour, time.Hour) || !e.allowed("mail-ip:"+r.Peer, e.p.MailIPHour, time.Hour) {
		return result(429, "retry_later")
	}
	e.reserved++
	e.operations[p.operation] = true
	e.lastMail[p.auth.Email] = now
	if err := e.provider.Mail(ctx, MailRequest{Action: strings.TrimPrefix(p.path, "/"), Email: p.auth.Email, Password: p.auth.Password, RequestID: p.operation, Peer: r.Peer}); err != nil {
		if errors.Is(err, ErrReplay) {
			return result(409, "request_already_attempted")
		}
		if errors.Is(err, ErrBudget) {
			return result(429, "retry_later")
		}
		return result(503, "mail_outcome_unknown")
	}
	return result(202, "confirmation_or_recovery_requested")
}

// Only explicit provider refusals are classified as known failures. Transport
// and timeout errors stay ambiguous and must not invite an automatic resend.
func explicitMailFailure(err error) (Response, bool) {
	var rate *rateFailure
	if errors.As(err, &rate) {
		return Response{Status: 429, Code: "retry_later", RetryAfterSeconds: rate.seconds}, true
	}
	var failure *wireFailure
	if errors.As(err, &failure) {
		return result(failure.status, failure.code), true
	}
	var rejected *providerRejection
	if errors.As(err, &rejected) {
		if rejected.status == 400 {
			return result(400, "invalid_request"), true
		}
		return result(rejected.status, "unauthorized"), true
	}
	if errors.Is(err, ErrDenied) {
		return result(400, "invalid_request"), true
	}
	return Response{}, false
}
