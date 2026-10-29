// Package auth verifies provider-issued access tokens. It never issues tokens or stores passwords.
package auth

import (
	"context"
	"errors"
	"github.com/coreos/go-oidc/v3/oidc"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Config struct {
	Provider                            string
	Issuer, JWKSURL, Audience, ClientID string
	AllowLoopbackHTTP                   bool
}
type Verifier struct {
	inner *oidc.IDTokenVerifier
	cfg   Config
}
type Principal struct {
	Issuer, Subject string
	AuthTime        int64
}

func (p Principal) Fresh(now time.Time) bool {
	delta := now.Unix() - p.AuthTime
	return p.AuthTime > 0 && delta >= -5 && delta <= 300
}
func validURL(raw string, allow bool) bool {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	return allow && u.Scheme == "http" && (host == "localhost" || ip != nil && ip.IsLoopback())
}
func New(ctx context.Context, cfg Config) (*Verifier, error) {
	if cfg.Provider == "" {
		cfg.Provider = "keycloak"
	}
	if (cfg.Provider != "keycloak" && cfg.Provider != "gotrue") || !validURL(cfg.Issuer, cfg.AllowLoopbackHTTP) || !validURL(cfg.JWKSURL, cfg.AllowLoopbackHTTP) || cfg.Audience == "" || (cfg.Provider == "keycloak" && cfg.ClientID == "") || (cfg.Provider == "gotrue" && cfg.Audience != "authenticated") {
		return nil, errors.New("invalid OIDC configuration")
	}
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return errors.New("JWKS redirect refused") }}
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(ctx, client), cfg.JWKSURL)
	algorithms := []string{oidc.RS256}
	if cfg.Provider == "gotrue" {
		algorithms = []string{oidc.ES256}
	}
	return &Verifier{inner: oidc.NewVerifier(cfg.Issuer, keys, &oidc.Config{ClientID: cfg.Audience, SupportedSigningAlgs: algorithms}), cfg: cfg}, nil
}
func (v *Verifier) Verify(ctx context.Context, raw string) (Principal, error) {
	deny := errors.New("invalid access token")
	if len(raw) == 0 || len(raw) > 16384 {
		return Principal{}, deny
	}
	tok, err := v.inner.Verify(ctx, raw)
	if err != nil {
		return Principal{}, deny
	}
	if v.cfg.Provider == "gotrue" {
		return v.verifyGoTrue(tok)
	}
	var claims struct {
		Type      string `json:"typ"`
		Client    string `json:"azp"`
		Scope     string `json:"scope"`
		AuthTime  int64  `json:"auth_time"`
		Issued    int64  `json:"iat"`
		NotBefore int64  `json:"nbf"`
	}
	if err = tok.Claims(&claims); err != nil {
		return Principal{}, deny
	}
	now := time.Now().Unix()
	scope := false
	for _, s := range strings.Fields(claims.Scope) {
		if s == "umar.sync" {
			scope = true
		}
	}
	if tok.Subject == "" || len(tok.Subject) > 256 || claims.Type != "Bearer" || claims.Client != v.cfg.ClientID || !scope || claims.Issued <= 0 || claims.Issued > now+5 || claims.NotBefore > now {
		return Principal{}, deny
	}
	return Principal{Issuer: v.cfg.Issuer, Subject: tok.Subject, AuthTime: claims.AuthTime}, nil
}
