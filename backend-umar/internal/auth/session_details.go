package auth

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
)

type GoTrueSession struct {
	Principal                         Principal
	SessionID, Audience, Role, Method string
	ExpiresAt                         time.Time
	Anonymous                         bool
}

func (GoTrueSession) String() string { return "GoTrueSession(redacted)" }

func parseGoTrueSession(raw []byte, p Principal, expiry, now time.Time) (GoTrueSession, error) {
	deny := errors.New("invalid access token")
	out := GoTrueSession{}
	if native.ValidateDocument(raw) != nil {
		return out, deny
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return out, deny
	}
	for name := range fields {
		for _, known := range []string{"role", "session_id", "is_anonymous", "iat", "nbf", "amr"} {
			if strings.EqualFold(name, known) && name != known {
				return out, deny
			}
		}
	}
	var c struct {
		Role      string `json:"role"`
		Session   string `json:"session_id"`
		Anonymous bool   `json:"is_anonymous"`
		Issued    int64  `json:"iat"`
		NotBefore int64  `json:"nbf"`
		AMR       []struct {
			Method    string `json:"method"`
			Timestamp int64  `json:"timestamp"`
		} `json:"amr"`
	}
	if json.Unmarshal(raw, &c) != nil || !uuidClaim.MatchString(p.Subject) || !uuidClaim.MatchString(c.Session) || c.Role != "authenticated" || c.Anonymous || c.Issued <= 0 || c.Issued > now.Unix()+5 || c.NotBefore > now.Unix() {
		return out, deny
	}
	method := ""
	var authentication int64
	for _, m := range c.AMR {
		if m.Timestamp > now.Unix()+5 || m.Timestamp > c.Issued+5 {
			return out, deny
		}
		switch m.Method {
		case "password", "oauth", "otp", "totp", "webauthn", "email/signup", "email/recovery", "sso/saml":
			if m.Timestamp > authentication {
				authentication = m.Timestamp
				method = m.Method
			}
		}
	}
	p.AuthTime = authentication
	return GoTrueSession{Principal: p, SessionID: c.Session, Audience: "authenticated", Role: c.Role, Method: method, ExpiresAt: expiry, Anonymous: c.Anonymous}, nil
}

// VerifyGoTrueSession only exposes claims after the established OIDC library
// verifies signature, algorithm, issuer, audience and expiry. No unsigned parse
// path is exported, and refresh never substitutes iat for authentication time.
func (v *Verifier) VerifyGoTrueSession(ctx context.Context, raw string) (GoTrueSession, error) {
	if v == nil || v.cfg.Provider != "gotrue" || len(raw) == 0 || len(raw) > 16384 {
		return GoTrueSession{}, errors.New("invalid access token")
	}
	tok, err := v.inner.Verify(ctx, raw)
	if err != nil {
		return GoTrueSession{}, errors.New("invalid access token")
	}
	var claims json.RawMessage
	if tok.Claims(&claims) != nil {
		return GoTrueSession{}, errors.New("invalid access token")
	}
	return parseGoTrueSession(claims, Principal{Issuer: v.cfg.Issuer, Subject: tok.Subject}, tok.Expiry, time.Now())
}
