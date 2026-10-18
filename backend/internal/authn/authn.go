// Package authn verifies Firebase ID tokens.
//
// Only the local Firebase Auth emulator is supported in this slice. Emulator tokens are unsigned
// test tokens, so a successful verification proves the local identity plumbing (issuer, audience,
// expiry, subject, provider) and nothing about production login readiness. A production verifier
// does not exist; the binary refuses production mode before it listens (package config).
package authn

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

var (
	// ErrUnauthenticated wraps every token rejection. The HTTP layer maps all of them to one
	// uniform 401 so the response is not an oracle for why a token failed.
	ErrUnauthenticated = errors.New("authn: unauthenticated")
	// ErrUnsafeConfig reports a verifier setup that could reach real Google services or accept
	// tokens for a non-demo project.
	ErrUnsafeConfig = errors.New("authn: unsafe verifier configuration")
)

const (
	// emulatorHostEnv is the process variable the Admin SDK reads to enter emulator mode.
	emulatorHostEnv   = "FIREBASE_AUTH_EMULATOR_HOST"
	issuerPrefix      = "https://securetoken.google.com/"
	providerAnonymous = "anonymous"
	// maxTokenBytes bounds what reaches the JWT decoder; emulator ID tokens are about 1 KiB.
	maxTokenBytes = 8 << 10
	// verifyTimeout bounds the emulator user lookup behind each verification.
	verifyTimeout = 10 * time.Second
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

// EmulatorConfig selects the demo project and the loopback Auth emulator.
type EmulatorConfig struct {
	// ProjectID must start with "demo-" (Firebase demo projects cannot reach real resources).
	ProjectID string
	// EmulatorHost is a literal loopback host:port. It must equal the process environment variable
	// FIREBASE_AUTH_EMULATOR_HOST, which the Admin SDK reads to enter emulator mode; without it the
	// SDK would fetch Google signing keys.
	EmulatorHost string
}

// EmulatorVerifier verifies emulator-issued ID tokens with the Firebase Admin SDK, created with an
// explicit project ID and option.WithoutAuthentication (no Application Default Credentials). It
// rejects anonymous sign-ins, so guests stay purely local.
type EmulatorVerifier struct {
	client    *auth.Client
	projectID string
	issuer    string
}

var _ Verifier = (*EmulatorVerifier)(nil)

// NewEmulatorVerifier validates cfg and builds the Admin SDK client.
func NewEmulatorVerifier(ctx context.Context, cfg EmulatorConfig) (*EmulatorVerifier, error) {
	if !isDemoProject(cfg.ProjectID) {
		return nil, fmt.Errorf(`%w: project ID must start with "demo-"`, ErrUnsafeConfig)
	}
	if !isLoopbackHostPort(cfg.EmulatorHost) {
		return nil, fmt.Errorf("%w: emulator host must be a literal loopback IP with an explicit non-zero port", ErrUnsafeConfig)
	}
	// The SDK decides emulator mode from the process environment alone. An empty or different value
	// would send verification to Google or to another emulator than the one checked above.
	if os.Getenv(emulatorHostEnv) != cfg.EmulatorHost {
		return nil, fmt.Errorf("%w: %s must equal the configured emulator host", ErrUnsafeConfig, emulatorHostEnv)
	}
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.ProjectID}, option.WithoutAuthentication())
	if err != nil {
		return nil, fmt.Errorf("authn: create Firebase app: %w", err)
	}
	client, err := app.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("authn: create Auth client: %w", err)
	}
	return &EmulatorVerifier{client: client, projectID: cfg.ProjectID, issuer: issuerPrefix + cfg.ProjectID}, nil
}

// Verify checks the token's issuer, audience, expiry, issue time and subject through the Admin SDK,
// requires the user to exist in the emulator (and not be disabled or revoked), and rejects tenant
// tokens and a missing or anonymous provider. Every failure wraps ErrUnauthenticated and never
// includes the token or its claims.
func (v *EmulatorVerifier) Verify(ctx context.Context, idToken string) (Identity, error) {
	switch {
	case v == nil || v.client == nil:
		return Identity{}, reject("verifier is not initialised")
	case idToken == "":
		return Identity{}, reject("empty token")
	case len(idToken) > maxTokenBytes:
		return Identity{}, reject("token too long")
	}
	ctx, cancel := context.WithTimeout(ctx, verifyTimeout)
	defer cancel()
	// In emulator mode the SDK skips the signature (emulator tokens carry none) but still checks the
	// claims; the revocation check always looks the user up in the emulator.
	tok, err := v.client.VerifyIDTokenAndCheckRevoked(ctx, idToken)
	if err != nil {
		return Identity{}, reject(sdkReason(err))
	}
	switch {
	case tok.Issuer != v.issuer || tok.Audience != v.projectID:
		return Identity{}, reject("issuer or audience is not the configured project")
	case tok.Subject == "" || tok.UID != tok.Subject:
		return Identity{}, reject("subject is missing")
	case tok.Firebase.Tenant != "":
		return Identity{}, reject("tenant tokens are not accepted")
	case tok.Firebase.SignInProvider == "":
		return Identity{}, reject("sign-in provider is missing")
	case tok.Firebase.SignInProvider == providerAnonymous:
		return Identity{}, reject("anonymous sign-ins stay on the device")
	}
	return Identity{Issuer: tok.Issuer, Subject: tok.Subject, SignInProvider: tok.Firebase.SignInProvider}, nil
}

func reject(reason string) error {
	return fmt.Errorf("%w: %s", ErrUnauthenticated, reason)
}

// sdkReason names the SDK's rejection without its message, which can quote claim values.
func sdkReason(err error) string {
	switch {
	case auth.IsIDTokenExpired(err):
		return "token expired"
	case auth.IsIDTokenRevoked(err):
		return "token revoked"
	case auth.IsUserNotFound(err):
		return "user unknown to the Auth emulator"
	case auth.IsIDTokenInvalid(err):
		return "token invalid"
	default:
		return "token could not be verified"
	}
}

// isDemoProject accepts "demo-" followed by lowercase letters, digits and hyphens.
func isDemoProject(id string) bool {
	rest, ok := strings.CutPrefix(id, "demo-")
	if !ok || rest == "" {
		return false
	}
	for i := 0; i < len(rest); i++ {
		if c := rest[i]; (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
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
