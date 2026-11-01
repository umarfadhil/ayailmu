package generalingress

import (
	"crypto/tls"
	"errors"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// RuntimeConfig contains no credential values. Enabled and MailEnabled default
// false. Constructing it does not create a listener, fetch JWKS or send mail.
type RuntimeConfig struct {
	Enabled                        bool
	Listen, UpstreamOrigin, CAHash string
	Revocation                     RevocationMode
	MaxAccessWindow                time.Duration
	Policy                         RuntimePolicy
}

// Ordinary app policy: provider token expiry is independent from service uptime.
// Simulation-only lifetime/mode fields are intentionally absent from this schema.
type RuntimePolicy struct {
	MailEnabled                                              bool
	Origin, Issuer, Audience                                 string
	MaxConcurrent, MailGlobal, MailRecipientHour, MailIPHour int
	AuthIPMinute, AuthRecipientMinute, MaxState              int
	MailCooldown                                             time.Duration
	DeclarationVersion, ConsentVersion                       string
}

func (p RuntimePolicy) enginePolicy() Policy {
	return Policy{MailEnabled: p.MailEnabled, Origin: p.Origin, Issuer: p.Issuer, Audience: p.Audience, MaxConcurrent: p.MaxConcurrent, MailGlobal: p.MailGlobal, MailRecipientHour: p.MailRecipientHour, MailIPHour: p.MailIPHour, AuthIPMinute: p.AuthIPMinute, AuthRecipientMinute: p.AuthRecipientMinute, MaxState: p.MaxState, MailCooldown: p.MailCooldown, DeclarationVersion: p.DeclarationVersion, ConsentVersion: p.ConsentVersion}
}

func (RuntimeConfig) String() string { return "RuntimeConfig(redacted)" }

var policyVersion = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,79}$`)

func canonicalHTTPS(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Hostname() != strings.ToLower(u.Hostname()) || u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || !ascii(raw) {
		return nil, ErrUnavailable
	}
	host := u.Hostname()
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if u.Port() != "" {
		n, e := strconv.Atoi(u.Port())
		if e != nil || n < 1 || n > 65535 || strconv.Itoa(n) != u.Port() {
			return nil, ErrUnavailable
		}
		host += ":" + u.Port()
	}
	if host != u.Host {
		return nil, ErrUnavailable
	}
	return u, nil
}
func loopbackHost(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || ip != nil && ip.IsLoopback()
}
func (c RuntimeConfig) Validate(now time.Time) error {
	p := c.Policy
	if !c.Enabled {
		if p.MailEnabled {
			return errors.New("disabled runtime cannot enable mail")
		}
		return nil
	}
	public, err := canonicalHTTPS(p.Origin)
	if err != nil || public == nil || p.Audience != "authenticated" {
		return ErrUnavailable
	}
	if _, err := canonicalHTTPS(p.Issuer); err != nil {
		return ErrUnavailable
	}
	upstream, err := canonicalHTTPS(c.UpstreamOrigin)
	if err != nil || !loopbackHost(upstream.Hostname()) || upstream.Port() == "" {
		return ErrUnavailable
	}
	host, port, err := net.SplitHostPort(c.Listen)
	ip := net.ParseIP(host)
	n, pe := strconv.Atoi(port)
	if err != nil || ip == nil || !ip.IsLoopback() || pe != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port || port == upstream.Port() {
		return ErrUnavailable
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(c.CAHash) || !policyVersion.MatchString(p.DeclarationVersion) || !policyVersion.MatchString(p.ConsentVersion) {
		return ErrUnavailable
	}
	if p.MaxConcurrent < 1 || p.MaxConcurrent > 4 || p.MaxState < 1 || p.MaxState > 10000 || p.AuthIPMinute < 1 || p.AuthRecipientMinute < 1 || p.MailGlobal < 0 || p.MailRecipientHour < 1 || p.MailIPHour < 1 || p.MailCooldown < time.Second {
		return ErrUnavailable
	}
	if c.Revocation != RequireSessionStatus && c.Revocation != AllowBoundedJWT || c.Revocation == AllowBoundedJWT && (c.MaxAccessWindow <= 0 || c.MaxAccessWindow > time.Hour) {
		return ErrUnavailable
	}
	return nil
}

// NewRuntime is separate from the unchanged offline-only constructor. Explicit
// deployment configuration is required; there is no owner/email allowlist.
// Provider verification remains authoritative, never decoded client identity.
func NewRuntime(c RuntimeConfig, clock Clock, v Verifier, p Provider, b Backend) (*Engine, error) {
	if !c.Enabled {
		if err := c.Validate(time.Time{}); err != nil {
			return nil, err
		}
		return New(Policy{}, nil, nil, nil, nil)
	}
	if clock == nil || v == nil || p == nil || b == nil || c.Validate(clock.Now()) != nil {
		return nil, ErrUnavailable
	}
	e := newEngineState(c.Policy.enginePolicy(), clock, v, p, b)
	e.runtime = true
	boundConfig := c
	e.runtimeConfig = &boundConfig
	u, _ := canonicalHTTPS(c.Policy.Origin)
	e.host = u.Host
	e.created = clock.Now()
	e.lastWall = e.created
	e.initialMono = clock.Elapsed()
	e.lastMono = e.initialMono
	e.slots = make(chan struct{}, c.Policy.MaxConcurrent)
	return e, nil
}

type runtimeHandler struct {
	config RuntimeConfig
	engine *Engine
}

func NewRuntimeHandler(c RuntimeConfig, e *Engine) (http.Handler, error) {
	if !c.Enabled {
		if c.Policy.MailEnabled {
			return nil, ErrUnavailable
		}
		return &runtimeHandler{}, nil
	}
	if e == nil || !e.runtime || e.runtimeConfig == nil || *e.runtimeConfig != c || e.clock == nil || c.Validate(e.clock.Now()) != nil || c.Policy.enginePolicy() != e.p {
		return nil, ErrUnavailable
	}
	return &runtimeHandler{c, e}, nil
}
func refuse(w http.ResponseWriter, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if status == 503 {
		io.WriteString(w, `{"error":"unavailable","error_code":"unavailable"}`)
	} else {
		io.WriteString(w, `{"error":"invalid_request","error_code":"invalid_request"}`)
	}
}
func (h *runtimeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.engine == nil || !h.config.Enabled {
		refuse(w, 503)
		return
	}
	// The TLS fact is supplied by net/http's TLS server, never forwarded headers.
	// The caller's IP comes from RemoteAddr. Until an edge trust contract exists,
	// a loopback connector shares one conservative IP bucket; do not trust XFF.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || net.ParseIP(host) == nil || r.TLS == nil || !r.TLS.HandshakeComplete || r.URL == nil || r.URL.IsAbs() || r.URL.Fragment != "" || len(r.TransferEncoding) > 0 || r.ContentLength < 0 || len(r.Header) > 20 {
		refuse(w, 400)
		return
	}
	target := r.RequestURI
	if target == "" {
		target = r.URL.RequestURI()
	}
	if target != r.URL.RequestURI() {
		refuse(w, 400)
		return
	}
	headers := [][2]string{{"Host", r.Host}}
	for k, values := range r.Header {
		if len(values) != 1 {
			refuse(w, 400)
			return
		}
		switch strings.ToLower(k) {
		case "cf-ray", "cf-connecting-ip", "cf-visitor", "cf-ipcountry", "cf-ew-via", "cf-warp-tag-id", "cf-worker", "cdn-loop", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-real-ip", "forwarded":
			// Transport metadata may arrive from a reverse proxy. Strip it;
			// never use a caller assertion to change TLS, host, identity or IP
			// rate buckets, and never forward it to auth/backend services.
			if !ascii(values[0]) || len(values[0]) > 4096 {
				refuse(w, 400)
				return
			}
			continue
		case "connection":
			if !strings.EqualFold(values[0], "keep-alive") && !strings.EqualFold(values[0], "close") {
				refuse(w, 400)
				return
			}
			continue
		case "accept-encoding":
			if !ascii(values[0]) || len(values[0]) > 128 {
				refuse(w, 400)
				return
			}
			continue // not forwarded; responses are uncompressed
		}
		headers = append(headers, [2]string{k, values[0]})
	}
	limit := requestBodyLimit(r.Method, target)
	if r.ContentLength > int64(limit) {
		refuse(w, 400)
		return
	}
	var body []byte
	if r.Body != nil {
		body, err = io.ReadAll(io.LimitReader(r.Body, int64(limit)+1))
		r.Body.Close()
	}
	if err != nil || len(body) > limit || int64(len(body)) != r.ContentLength {
		refuse(w, 400)
		return
	}
	response := h.engine.Handle(r.Context(), Request{Method: r.Method, Target: target, Peer: host, TLS: true, Headers: headers, Body: body})
	status, out := EncodeResponse(response)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if status == 429 && response.RetryAfterSeconds >= 1 && response.RetryAfterSeconds <= 3600 {
		w.Header().Set("Retry-After", strconv.Itoa(response.RetryAfterSeconds))
	}
	w.WriteHeader(status)
	w.Write(out)
}

// Server returns a loopback-only, TLS-required server description. It does not
// listen, load a private key or activate anything. Serving is a separate action.
func RuntimeServer(c RuntimeConfig, h http.Handler, now time.Time) (*http.Server, error) {
	bound, ok := h.(*runtimeHandler)
	if !c.Enabled || c.Validate(now) != nil || !ok || bound == nil || bound.config != c || bound.engine == nil || bound.engine.runtimeConfig == nil || *bound.engine.runtimeConfig != c {
		return nil, ErrUnavailable
	}
	return &http.Server{Addr: c.Listen, Handler: h, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32768, ErrorLog: log.New(io.Discard, "", 0)}, nil
}

// Strict non-secret config decoding; no environment or credential-file fallback.
func ParseRuntimeConfig(raw []byte, now time.Time) (RuntimeConfig, error) {
	var c RuntimeConfig
	if len(raw) > 16384 {
		return c, ErrUnavailable
	}
	if native.Decode(raw, &c) != nil || c.Validate(now) != nil {
		return RuntimeConfig{}, ErrUnavailable
	}
	return c, nil
}

// Stop invalidates only this in-memory gateway state; it never deletes accounts,
// app data, provider sessions, mail reservations or backend records.
func (e *Engine) Stop() { e.mu.Lock(); defer e.mu.Unlock(); e.halt() }
func (p *HTTPProvider) CloseIdleConnections() {
	if p != nil && p.client != nil {
		p.client.CloseIdleConnections()
	}
}
