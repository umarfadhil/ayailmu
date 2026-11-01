package auth

import (
	"errors"
	"regexp"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

var uuidClaim = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// GoTrue owns identity and session issuance. Only provider-signed claims count;
// user_metadata never grants a role, an owner identity or fresh authentication.
func (v *Verifier) verifyGoTrue(tok *oidc.IDToken) (Principal, error) {
	deny := errors.New("invalid access token")
	var claims struct {
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
	if tok.Claims(&claims) != nil {
		return Principal{}, deny
	}
	now := time.Now().Unix()
	if !uuidClaim.MatchString(tok.Subject) || !uuidClaim.MatchString(claims.Session) || claims.Role != "authenticated" || claims.Anonymous || claims.Issued <= 0 || claims.Issued > now+5 || claims.NotBefore > now {
		return Principal{}, deny
	}
	var authentication int64
	for _, method := range claims.AMR {
		if method.Timestamp > now+5 || method.Timestamp > claims.Issued+5 {
			return Principal{}, deny
		}
		switch method.Method {
		case "password", "oauth", "otp", "totp", "webauthn", "email/signup", "email/recovery", "sso/saml":
			if method.Timestamp > authentication {
				authentication = method.Timestamp
			}
		}
	}
	return Principal{Issuer: v.cfg.Issuer, Subject: tok.Subject, AuthTime: authentication}, nil
}
