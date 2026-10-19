package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"ayailmu.local/backend/internal/authn"
)

// errUnauthenticated stands for every authentication failure; they all get the same 401.
var errUnauthenticated = errors.New("httpapi: unauthenticated")

const (
	// maxBearerBytes bounds what reaches the verifier; emulator ID tokens are about 1 KiB.
	maxBearerBytes = 8 << 10
	// Bounds of the verified identity that keys an account (Firebase UIDs are at most 128 bytes).
	maxIssuerBytes  = 256
	maxSubjectBytes = 128
)

// caller is an authenticated request's account and verified identity.
type caller struct {
	accountID string
	// deleted reports that the account's deletion is recorded (the deleted-account gate).
	deleted  bool
	identity authn.Identity
	// authTime is the verified sign-in time; zero when the verifier cannot report it or the token
	// carries none.
	authTime time.Time
}

// authenticate verifies the bearer token and returns the caller, creating the account on first use
// under the configured account mode. With a session-capable verifier, the one verification also yields
// the sign-in time. Every rejection is errUnauthenticated; any other error is a store failure.
func (h *handler) authenticate(r *http.Request) (caller, error) {
	token, ok := bearerToken(r.Header.Values("Authorization"))
	if !ok {
		return caller{}, errUnauthenticated
	}
	var s authn.Session
	var err error
	if h.sessions != nil {
		s, err = h.sessions.VerifySession(r.Context(), token)
	} else {
		s.Identity, err = h.verifier.Verify(r.Context(), token)
	}
	if err != nil || !storableIdentity(s.Identity) {
		return caller{}, errUnauthenticated
	}
	acct, err := h.store.EnsureAccount(r.Context(), h.accountMode, s.Issuer, s.Subject)
	if err != nil {
		return caller{}, err
	}
	return caller{accountID: acct.ID, deleted: acct.Deleted, identity: s.Identity, authTime: s.AuthTime}, nil
}

// bearerToken returns the token of exactly one "Authorization: Bearer <token>" header: scheme
// case-insensitive, token in RFC 6750 b64token syntax and at most maxBearerBytes.
func bearerToken(values []string) (string, bool) {
	if len(values) != 1 {
		return "", false
	}
	scheme, token, ok := strings.Cut(values[0], " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	token = strings.TrimLeft(token, " ")
	if token == "" || len(token) > maxBearerBytes || !isB64Token(token) {
		return "", false
	}
	return token, true
}

// isB64Token matches 1*( ALPHA / DIGIT / "-" / "." / "_" / "~" / "+" / "/" ) *"=".
func isB64Token(s string) bool {
	body := strings.TrimRight(s, "=")
	if body == "" {
		return false
	}
	for i := 0; i < len(body); i++ {
		c := body[i]
		alnum := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
		if !alnum && !strings.ContainsRune("-._~+/", rune(c)) {
			return false
		}
	}
	return true
}

// storableIdentity reports whether a verified identity can key an account: issuer and subject are
// non-empty, bounded, valid UTF-8 and free of NUL, which PostgreSQL text cannot hold.
func storableIdentity(id authn.Identity) bool {
	return storableText(id.Issuer, maxIssuerBytes) && storableText(id.Subject, maxSubjectBytes)
}

func storableText(s string, maxBytes int) bool {
	return s != "" && len(s) <= maxBytes && utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
