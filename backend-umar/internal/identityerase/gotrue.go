// Package identityerase provides the provider step only. It is not connected to an API,
// runtime configuration or background worker until durable account erasure is implemented.
package identityerase

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
)

var ErrIdentityNotDeleted = errors.New("identity deletion not confirmed")
var ErrConfiguration = errors.New("invalid identity-erasure configuration")

const deleteTimeout = 10 * time.Second
const maxReply = 4096

type Config struct{ Issuer, AdminOrigin, AdminToken string }

// Configuration and provider values must be safe to include in ordinary diagnostic output.
func (Config) String() string     { return "identityerase.Config{redacted}" }
func (c Config) GoString() string { return c.String() }

type Provider struct {
	issuer, usersURL, token string
	client                  *http.Client
}

func (Provider) String() string     { return "identityerase.Provider{redacted}" }
func (p Provider) GoString() string { return p.String() }

// New requires an explicitly supplied HTTPS administration origin and credential.
// It never discovers credentials or uses a cookie jar, redirects or ambient HTTP proxy.
func New(cfg Config) (*Provider, error) {
	transport := &http.Transport{
		DialContext:         (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 5 * time.Second,
		IdleConnTimeout: 30 * time.Second, MaxIdleConns: 2, MaxIdleConnsPerHost: 2,
	}
	return newWithClient(cfg, &http.Client{Transport: transport})
}

// newWithClient is an unexported seam for isolated TLS fixtures, not a runtime TLS bypass.
func newWithClient(cfg Config, supplied *http.Client) (*Provider, error) {
	issuerURL, issuerOK := httpsURL(cfg.Issuer)
	originURL, originOK := httpsURL(cfg.AdminOrigin)
	if !issuerOK || !originOK || (originURL.Path != "" && originURL.Path != "/") || issuerURL.RawPath != "" || !validToken(cfg.AdminToken) || supplied == nil {
		return nil, ErrConfiguration
	}
	client := *supplied
	client.Timeout = deleteTimeout
	client.Jar = nil
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Provider{issuer: cfg.Issuer, usersURL: strings.TrimSuffix(cfg.AdminOrigin, "/") + "/admin/users/", token: cfg.AdminToken, client: &client}, nil
}

// DeleteIdentity implements the GoTrue v2.197.0 hard-delete response contract. A lost
// response is never completion: a durable caller must retry the same recorded identity.
// This operation alone does not erase app data or create an account-deletion receipt.
func (p *Provider) DeleteIdentity(ctx context.Context, issuer, subject string) error {
	if p == nil || p.client == nil || issuer != p.issuer || !canonicalUUID(subject) || ctx == nil {
		return ErrIdentityNotDeleted
	}
	ctx, cancel := context.WithTimeout(ctx, deleteTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, p.usersURL+subject, strings.NewReader(`{"should_soft_delete":false}`))
	if err != nil {
		return ErrIdentityNotDeleted
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	reply, err := p.client.Do(req)
	if err != nil {
		return ErrIdentityNotDeleted
	}
	defer reply.Body.Close()
	data, err := io.ReadAll(io.LimitReader(reply.Body, maxReply+1))
	if err != nil || len(data) > maxReply || native.ValidateDocument(data) != nil {
		return ErrIdentityNotDeleted
	}
	switch reply.StatusCode {
	case http.StatusOK:
		var object map[string]json.RawMessage
		if json.Unmarshal(data, &object) == nil && object != nil && len(object) == 0 {
			return nil
		}
	case http.StatusNotFound:
		var failure struct {
			Code      int    `json:"code"`
			ErrorCode string `json:"error_code"`
			Message   string `json:"msg"`
			ErrorID   string `json:"error_id"`
		}
		if native.Decode(data, &failure) == nil && failure.Code == http.StatusNotFound && failure.ErrorCode == "user_not_found" {
			return nil
		}
	}
	// Never echo a provider response, URL, identity, credential or transport error.
	return ErrIdentityNotDeleted
}

func httpsURL(raw string) (*url.URL, bool) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 || strings.ContainsAny(raw, "?#") || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" || u.RawPath != "" || u.ForceQuery {
		return nil, false
	}
	return u, true
}
func validToken(token string) bool {
	if len(token) == 0 || len(token) > 16384 {
		return false
	}
	for i := 0; i < len(token); i++ {
		if token[i] <= 32 || token[i] > 126 {
			return false
		}
	}
	return true
}
func canonicalUUID(id string) bool {
	if len(id) != 36 || id == "00000000-0000-0000-0000-000000000000" {
		return false
	}
	for i := 0; i < len(id); i++ {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if id[i] != '-' {
				return false
			}
		} else if (id[i] < '0' || id[i] > '9') && (id[i] < 'a' || id[i] > 'f') {
			return false
		}
	}
	return true
}

// Issuer identifies the one authentication authority this adapter may erase from.
func (p *Provider) Issuer() string {
	if p == nil {
		return ""
	}
	return p.issuer
}
