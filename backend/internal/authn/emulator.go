//go:build firebase_emulator

package authn

// The legacy Firebase Auth emulator adapter. Only a build with the firebase_emulator tag includes it, and it is the
// only code that imports the Firebase Admin SDK; a default build has no emulator support (ErrEmulatorDisabled).

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

const (
	// emulatorHostEnv is the process variable the Admin SDK reads to enter emulator mode.
	emulatorHostEnv = "FIREBASE_AUTH_EMULATOR_HOST"
	issuerPrefix    = "https://securetoken.google.com/"
	// maxUIDBytes is the longest Firebase user ID.
	maxUIDBytes = 128
)

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
// explicit project ID and option.WithoutAuthentication (no Application Default Credentials), and
// deletes emulator accounts for account deletion. It rejects anonymous sign-ins, so guests stay
// purely local.
type EmulatorVerifier struct {
	client    *auth.Client
	projectID string
	issuer    string
}

var (
	_ SessionVerifier = (*EmulatorVerifier)(nil)
	_ IdentityDeleter = (*EmulatorVerifier)(nil)
)

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
	s, err := v.VerifySession(ctx, idToken)
	return s.Identity, err
}

// VerifySession makes Verify's checks and also reports the token's auth_time claim, read by the SDK
// from the verified token, as the sign-in time. A missing or non-positive auth_time leaves AuthTime
// zero, which no recent-sign-in check accepts.
func (v *EmulatorVerifier) VerifySession(ctx context.Context, idToken string) (Session, error) {
	switch {
	case v == nil || v.client == nil:
		return Session{}, reject("verifier is not initialised")
	case idToken == "":
		return Session{}, reject("empty token")
	case len(idToken) > maxTokenBytes:
		return Session{}, reject("token too long")
	}
	ctx, cancel := context.WithTimeout(ctx, verifyTimeout)
	defer cancel()
	// In emulator mode the SDK skips the signature (emulator tokens carry none) but still checks the
	// claims; the revocation check always looks the user up in the emulator.
	tok, err := v.client.VerifyIDTokenAndCheckRevoked(ctx, idToken)
	if err != nil {
		return Session{}, reject(sdkReason(err))
	}
	switch {
	case tok.Issuer != v.issuer || tok.Audience != v.projectID:
		return Session{}, reject("issuer or audience is not the configured project")
	case tok.Subject == "" || tok.UID != tok.Subject:
		return Session{}, reject("subject is missing")
	case tok.Firebase.Tenant != "":
		return Session{}, reject("tenant tokens are not accepted")
	case tok.Firebase.SignInProvider == "":
		return Session{}, reject("sign-in provider is missing")
	case tok.Firebase.SignInProvider == providerAnonymous:
		return Session{}, reject("anonymous sign-ins stay on the device")
	}
	s := Session{Identity: Identity{Issuer: tok.Issuer, Subject: tok.Subject, SignInProvider: tok.Firebase.SignInProvider}}
	if tok.AuthTime > 0 {
		s.AuthTime = time.Unix(tok.AuthTime, 0)
	}
	return s, nil
}

// DeleteIdentity deletes the identity's Auth emulator account with the Admin SDK's DeleteUser. A user
// the emulator reports as not found counts as deleted. An identity of another issuer is refused
// without a call. Failures wrap ErrIdentityNotDeleted with a fixed reason, never the SDK's message.
func (v *EmulatorVerifier) DeleteIdentity(ctx context.Context, id Identity) error {
	switch {
	case v == nil || v.client == nil:
		return notDeleted("verifier is not initialised")
	case id.Issuer != v.issuer:
		return notDeleted("the identity belongs to another issuer")
	case id.Subject == "" || len(id.Subject) > maxUIDBytes:
		return notDeleted("the subject is not a user ID")
	}
	ctx, cancel := context.WithTimeout(ctx, deleteTimeout)
	defer cancel()
	err := v.client.DeleteUser(ctx, id.Subject)
	switch {
	case err == nil || auth.IsUserNotFound(err):
		return nil
	case ctx.Err() != nil:
		return notDeleted("the Auth emulator did not answer in time")
	default:
		return notDeleted("the Auth emulator did not delete the user")
	}
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
