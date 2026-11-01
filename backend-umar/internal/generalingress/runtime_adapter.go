package generalingress

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"net"
	"net/http"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
)

// NewRuntimeTransport constructs but never calls a private-upstream transport.
// It has no environment proxy, public dial, insecure TLS or redirect fallback.
func NewRuntimeTransport(c RuntimeConfig, rootPEM []byte, now time.Time) (http.RoundTripper, error) {
	if !c.Enabled || c.Validate(now) != nil {
		return nil, ErrUnavailable
	}
	block, rest := pem.Decode(rootPEM)
	if block == nil || block.Type != "CERTIFICATE" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, ErrUnavailable
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !cert.IsCA {
		return nil, ErrUnavailable
	}
	pin := sha256.Sum256(cert.Raw)
	if hex.EncodeToString(pin[:]) != c.CAHash {
		return nil, ErrUnavailable
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	upstream, _ := canonicalHTTPS(c.UpstreamOrigin)
	expected := upstream.Host
	dialHost := upstream.Hostname()
	if dialHost == "localhost" {
		dialHost = "127.0.0.1"
	}
	actual := net.JoinHostPort(dialHost, upstream.Port())
	dialer := &net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{Proxy: nil, DisableCompression: true, ForceAttemptHTTP2: false, MaxConnsPerHost: 4, MaxIdleConns: 4, MaxIdleConnsPerHost: 4, IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 2 * time.Second, TLSHandshakeTimeout: 2 * time.Second, MaxResponseHeaderBytes: 32768, TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: upstream.Hostname(), MinVersion: tls.VersionTLS12}}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" || address != expected {
			return nil, ErrUnavailable
		}
		return dialer.DialContext(ctx, "tcp", actual)
	}
	return &guardedTransport{base: transport, origin: c.UpstreamOrigin, host: upstream.Host, tlsName: upstream.Hostname(), pin: c.CAHash}, nil
}

type runtimeSessionReader struct{ v *auth.Verifier }

func (*runtimeSessionReader) OfflineOnly() bool { return false }
func (r *runtimeSessionReader) Read(ctx context.Context, token string) (auth.GoTrueSession, error) {
	return r.v.VerifyGoTrueSession(ctx, token)
}

// Explicit real dependency construction. This does not contact the provider:
// go-oidc fetches private JWKS lazily, only on an actual authorized request.
func NewRuntimeHTTPAdapters(c RuntimeConfig, clock Clock, rootPEM []byte, authority SessionAuthority, budget *Budget, keyer IdentityKeyer) (*HTTPProvider, *HTTPBackend, error) {
	if !c.Enabled {
		p := &HTTPProvider{}
		return p, &HTTPBackend{p}, nil
	}
	if clock == nil || c.Validate(clock.Now()) != nil {
		return nil, nil, ErrUnavailable
	}
	transport, err := NewRuntimeTransport(c, rootPEM, clock.Now())
	if err != nil {
		return nil, nil, err
	}
	return runtimeAdapters(c, clock, transport, nil, authority, budget, keyer)
}

// Injection seam for in-process tests, not an exported default-network option.
// The application composition above always uses the pinned private transport.
func runtimeAdapters(c RuntimeConfig, clock Clock, transport http.RoundTripper, reader SessionReader, authority SessionAuthority, budget *Budget, keyer IdentityKeyer) (*HTTPProvider, *HTTPBackend, error) {
	if !c.Enabled || clock == nil || c.Validate(clock.Now()) != nil || transport == nil || c.Revocation == RequireSessionStatus && authority == nil {
		return nil, nil, ErrUnavailable
	}
	if (budget != nil || keyer != nil) && (!c.Policy.MailEnabled || budget == nil || !budget.runtime || keyer == nil || !budget.policy.Deadline.IsZero() || budget.policy.Global != c.Policy.MailGlobal || budget.policy.RecipientHour != c.Policy.MailRecipientHour || budget.policy.IPHour != c.Policy.MailIPHour || budget.policy.Cooldown != c.Policy.MailCooldown || budget.policy.IdentityBinding != keyer.PolicyBinding() || budget.Check(context.Background(), clock.Now()) != nil) {
		return nil, nil, ErrUnavailable
	}
	cfg := AdapterConfig{PublicOrigin: c.Policy.Origin, Issuer: c.Policy.Issuer, UpstreamOrigin: c.UpstreamOrigin, CAHash: c.CAHash, Now: clock.Now, DeclarationVersion: c.Policy.DeclarationVersion, ConsentVersion: c.Policy.ConsentVersion, Revocation: c.Revocation, MaxAccessWindow: c.MaxAccessWindow}
	upstream, _ := canonicalHTTPS(c.UpstreamOrigin)
	guarded := &guardedTransport{base: transport, origin: c.UpstreamOrigin, host: upstream.Host, tlsName: upstream.Hostname(), pin: c.CAHash}
	p := &HTTPProvider{runtime: true, cfg: cfg, authority: authority, budget: budget, keyer: keyer, recovery: map[[32]byte]bool{}, client: &http.Client{Transport: guarded, Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if reader == nil {
		verifier, err := auth.NewWithClient(context.Background(), auth.Config{Provider: "gotrue", Issuer: c.Policy.Issuer, JWKSURL: c.UpstreamOrigin + "/.well-known/jwks.json", Audience: "authenticated"}, p.client)
		if err != nil {
			return nil, nil, ErrUnavailable
		}
		reader = &runtimeSessionReader{verifier}
	}
	p.reader = reader
	if c.Policy.MailEnabled && budget == nil && keyer == nil {
		p.mailGate = newMailAdmission(c, clock.Now)
	}
	return p, &HTTPBackend{p}, nil
}

func NewRuntimeKeyer(enabled bool, id, scope string, dedicatedKey []byte) (*HMACKeyer, error) {
	if !enabled {
		return nil, ErrStorage
	}
	keyer, err := NewHMACKeyer(true, id, scope, dedicatedKey)
	if err != nil {
		return nil, err
	}
	keyer.runtime = true
	return keyer, nil
}
func NewRuntimeBudget(enabled bool, policy BudgetPolicy, disk *FileJournal) (*Budget, error) {
	if !enabled || policy.Simulation || !policy.Deadline.IsZero() || disk == nil {
		return nil, ErrStorage
	}
	budget, err := NewBudget(policy, disk)
	if err != nil {
		return nil, err
	}
	budget.runtime = true
	return budget, nil
}

// Check reads an existing initialized policy without initializing/resetting it,
// reserving a send or calling a provider. Runtime startup can fail closed early.
func (b *Budget) Check(ctx context.Context, now time.Time) error {
	if b == nil || !b.valid(now) {
		return ErrStorage
	}
	return b.disk.locked(ctx, func() error {
		raw, err := b.disk.read()
		if err != nil {
			return ErrStorage
		}
		state, err := decodeBudget(raw)
		if err != nil || state.Policy != b.fingerprint || now.UnixNano() < state.LastWall || len(state.Reservations) > b.maxStoredReservations() {
			return ErrStorage
		}
		return nil
	})
}
