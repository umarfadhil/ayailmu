package store

import (
	"crypto/tls"
	"errors"
	"net/netip"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// The transport rule of the deploy-mode opener (OpenAllowing, ParseConfigAllowing), applied to the configuration pgx actually
// parsed, so the connection string, the PG* environment and the service file all count, and to every target pgx would try,
// the primary and each fallback:
//
//   - a literal loopback IP or a Unix socket directory is local and needs no TLS;
//   - any other target must be reached over verified TLS: sslmode=verify-full, so that the server certificate is verified
//     against the configured roots (the system's, or sslrootcert) and against the host name that is dialed;
//   - that excludes disable, allow, prefer, require and verify-ca, and with them every plaintext fallback pgx would try,
//     because those modes either send plaintext or encrypt without authenticating the server;
//   - one explicit exception, PrivateNetwork(true), lets sslmode=disable reach a private target: a single-label host name
//     (a container network's service name) or a private-range IP address. The exception never covers a public DNS name or
//     address, and never an opportunistic or unverified TLS mode, whose silent plaintext fallback is what the rule forbids.
var (
	// ErrDatabaseTransportInsecure reports a target that is not reached over verified TLS, or a mode (prefer, allow, require,
	// verify-ca) that could fall back to plaintext or skip verification. Its text names neither a host nor a setting value.
	ErrDatabaseTransportInsecure = errors.New("store: every database host pgx would dial, except a literal loopback IP or a Unix socket, must be reached over verified TLS (sslmode=verify-full, the host name checked against the server certificate) with no plaintext fallback")
	// ErrDatabasePlaintextNotPrivate reports plaintext to a target the private-network exception does not cover: a public DNS
	// name or a public address.
	ErrDatabasePlaintextNotPrivate = errors.New("store: plaintext database transport is allowed only by the explicit private-network setting, with sslmode=disable, to a single-label host name or a private-range IP address")
)

// Option adjusts how OpenAllowing and ParseConfigAllowing treat the database transport. Without any option the strictest rule
// applies.
type Option func(*options)

type options struct{ privateNetwork bool }

// PrivateNetwork states whether the caller explicitly allows sslmode=disable to a private target (see the rule above). The
// default, and PrivateNetwork(false), allow none: a remote target must then be reached over verified TLS.
func PrivateNetwork(allow bool) Option { return func(o *options) { o.privateNetwork = allow } }

// checkTransport applies the rule to every target of cc.
func checkTransport(cc *pgconn.Config, o options) error {
	if err := checkTarget(cc.Host, cc.TLSConfig, o); err != nil {
		return err
	}
	for _, fb := range cc.Fallbacks {
		if err := checkTarget(fb.Host, fb.TLSConfig, o); err != nil {
			return err
		}
	}
	return nil
}

func checkTarget(host string, cfg *tls.Config, o options) error {
	switch {
	case localHost(host), verifiedTLS(host, cfg):
		return nil
	case o.privateNetwork && cfg == nil:
		// Plaintext was asked for outright (sslmode=disable): only a private target may have it. Any other mode that leaves
		// a plaintext path open carries a TLS configuration and is refused below.
		if privateHost(host) {
			return nil
		}
		return ErrDatabasePlaintextNotPrivate
	default:
		return ErrDatabaseTransportInsecure
	}
}

// verifiedTLS reports whether cfg verifies the server's certificate chain and that it is valid for exactly the dialed host,
// which is what pgx's sslmode=verify-full sets up.
func verifiedTLS(host string, cfg *tls.Config) bool {
	return cfg != nil && !cfg.InsecureSkipVerify && cfg.ServerName == host && host != "" &&
		cfg.VerifyPeerCertificate == nil && cfg.VerifyConnection == nil &&
		(cfg.MinVersion == 0 || cfg.MinVersion >= tls.VersionTLS12)
}

// privateHost accepts a single-label host name (no dot, so it cannot be a public DNS name) or an IP literal in a private
// range (RFC 1918, or the IPv6 unique local range), written without zone or IPv4 mapping. Loopback is local already.
func privateHost(h string) bool {
	if a, err := netip.ParseAddr(h); err == nil {
		return a.Zone() == "" && !a.Is4In6() && a.IsPrivate()
	}
	return h != "" && !strings.Contains(h, ".") && !strings.HasPrefix(h, "/")
}
