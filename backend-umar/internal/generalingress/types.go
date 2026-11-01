// Package generalingress provides the ordinary app's explicit TLS/auth boundary.
// Construction does not listen or send mail. Runtime adapters use a pinned
// private upstream; simulation adapters require mock-only transports and .invalid
// origins. Existing OIDC libraries own token verification.
package generalingress

import (
	"context"
	"errors"
	"time"
)

// ErrDenied is a provider's explicit credential/OTP rejection. Transport or
// uncertain errors must not be translated into an incorrect-password result.
var ErrDenied = errors.New("provider denied authentication")

type Policy struct {
	Simulation, MailEnabled                                  bool
	Origin, Issuer, Audience                                 string
	Deadline                                                 time.Time
	MaxConcurrent, MailGlobal, MailRecipientHour, MailIPHour int
	AuthIPMinute, AuthRecipientMinute, MaxState              int
	MailCooldown                                             time.Duration
	DeclarationVersion, ConsentVersion                       string
}

type Request struct {
	Method, Target, Peer string
	TLS                  bool        // Trusted adapter fact; not a request/header assertion in any future server.
	Headers              [][2]string // Preserve duplicates for refusal before forwarding.
	Body                 []byte
}

func (Request) String() string { return "Request(redacted)" }

type Response struct {
	Status            int
	Code              string
	Session           *Session
	User              *User
	Data              any
	ExpiresIn         int64
	RetryAfterSeconds int
}

func (Response) String() string { return "Response(redacted)" }

type Claims struct {
	Issuer, Audience, Subject, SessionID, Role, Method string
	Anonymous                                          bool
	ExpiresAt, AuthTime                                time.Time
}

func (Claims) String() string { return "VerifiedClaims(redacted)" }

type User struct {
	ID, SessionID, Email, ConfirmedAt string
	Confirmed, Anonymous, Revoked     bool
}

func (User) String() string { return "User(redacted)" }

type Session struct{ AccessToken, RefreshToken, Redirect string }

func (Session) String() string { return "Session(redacted)" }

type AuthRequest struct{ Grant, Email, Password, Code, Type, RefreshToken string }

func (AuthRequest) String() string { return "AuthRequest(redacted)" }

type MailRequest struct{ Action, Email, Password, RequestID, Peer string }

func (MailRequest) String() string { return "MailRequest(redacted)" }

type Clock interface {
	Now() time.Time
	Elapsed() time.Duration
}

// Verifier must supply provider-signed claims, never unverified decoded JSON.
// The adapter uses auth.Verifier.VerifyGoTrueSession to expose authenticated
// claims after the established library signature/issuer/audience checks.
type Verifier interface {
	OfflineOnly() bool
	Verify(context.Context, string) (Claims, error)
}
type Provider interface {
	OfflineOnly() bool
	Mail(context.Context, MailRequest) error
	Authenticate(context.Context, AuthRequest) (Session, error)
	Inspect(context.Context, string) (User, error) // Confirm user and enforce explicitly selected revocation profile.
	Logout(context.Context, string) error
	UpdatePassword(context.Context, string, string) (User, error)
}
type Backend interface {
	OfflineOnly() bool
	Owns(context.Context, Claims, string, string) (bool, error)
	Call(context.Context, Claims, string, string, []byte, string) (any, error)
}
type Snapshot struct {
	MailReserved, ActiveSessions int
	Halted                       bool
}
