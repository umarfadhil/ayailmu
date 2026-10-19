// Package authn verifies access tokens and, for account deletion, deletes the verified identity's
// account.
//
// The ports are provider-neutral: Verifier, SessionVerifier (the verified sign-in time) and
// IdentityDeleter. Every implementation serves local synthetic fixtures only.
//
// SupabaseVerifier is for one standalone Supabase Auth (GoTrue v2.197.0): go-jose verifies each
// token's asymmetric signature with Auth's configured or fetched public keys, its claims are checked
// strictly, and Auth's GET /user confirms the user and session. The server wires it in the local
// synthetic Supabase mode, against a loopback Auth (package config).
//
// EmulatorVerifier is for the local Firebase Auth emulator and the legacy synthetic regression
// fixtures. It exists only in a build with the firebase_emulator tag (emulator.go), the only build
// that imports the Firebase Admin SDK; a default build has no emulator support, and its server
// refuses emulator mode with ErrEmulatorDisabled. Emulator tokens are unsigned test tokens, so a
// successful verification proves the local identity plumbing (issuer, audience, expiry, subject,
// provider, sign-in time) and nothing about production login readiness.
//
// No production verifier is wired: the binary refuses production mode before it listens (package
// config).
package authn

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"time"
)

var (
	// ErrUnauthenticated wraps every token rejection. The HTTP layer maps all of them to one
	// uniform 401 so the response is not an oracle for why a token failed.
	ErrUnauthenticated = errors.New("authn: unauthenticated")
	// ErrUnsafeConfig reports a verifier setup that could reach real Google services or accept
	// tokens for a non-demo project.
	ErrUnsafeConfig = errors.New("authn: unsafe verifier configuration")
	// ErrIdentityNotDeleted wraps every failed identity deletion. The wrapping adds a fixed reason,
	// never the provider's message or the subject.
	ErrIdentityNotDeleted = errors.New("authn: the identity account was not deleted")
	// ErrEmulatorDisabled reports a binary built without the legacy Firebase Auth emulator verifier,
	// which only the firebase_emulator build tag includes: such a binary refuses emulator mode before
	// it opens anything.
	ErrEmulatorDisabled = errors.New("authn: Firebase Auth emulator support is not built into this binary (build tag firebase_emulator)")
)

const (
	providerAnonymous = "anonymous"
	// maxTokenBytes bounds what reaches the JWT decoder, and any bearer credential sent.
	maxTokenBytes = 8 << 10
	// verifyTimeout bounds the provider calls behind each verification.
	verifyTimeout = 10 * time.Second
	// deleteTimeout bounds one identity account deletion at the provider.
	deleteTimeout = 10 * time.Second
)

// Identity is the verified caller. Email, name, phone and photo claims are deliberately absent:
// the backend never stores them.
type Identity struct {
	Issuer         string
	Subject        string
	SignInProvider string
}

// Verifier checks an ID token (the bearer credential without the "Bearer " prefix).
type Verifier interface {
	Verify(ctx context.Context, idToken string) (Identity, error)
}

// Session is a verified caller and the time it signed in. It is separate from Identity, which is
// compared by value and so stays as it is.
type Session struct {
	Identity
	// AuthTime is the verified sign-in time: when the user last signed in with a credential, which
	// token refreshes keep (unlike the token's issue time). It is zero when the token carries none.
	AuthTime time.Time
}

// SessionVerifier is a Verifier that also reports the verified sign-in time, which actions that need
// a recent sign-in check.
type SessionVerifier interface {
	Verifier
	VerifySession(ctx context.Context, idToken string) (Session, error)
}

// IdentityDeleter deletes a verified identity's account at its identity provider.
type IdentityDeleter interface {
	// DeleteIdentity deletes the identity's provider account. An account the provider reports as not
	// found counts as deleted, so a repeat is harmless. Failures wrap ErrIdentityNotDeleted.
	DeleteIdentity(ctx context.Context, id Identity) error
}

func reject(reason string) error {
	return fmt.Errorf("%w: %s", ErrUnauthenticated, reason)
}

func notDeleted(reason string) error {
	return fmt.Errorf("%w: %s", ErrIdentityNotDeleted, reason)
}

// isLoopbackHostPort accepts a literal loopback IP with an explicit non-zero port, written
// canonically and without a zone. Hostnames, "localhost" included, are refused.
func isLoopbackHostPort(s string) bool {
	ap, err := netip.ParseAddrPort(s)
	if err != nil {
		return false
	}
	a := ap.Addr()
	return a.IsLoopback() && a.Zone() == "" && !a.Is4In6() && ap.Port() != 0 && ap.String() == s
}
