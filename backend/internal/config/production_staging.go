package config

import (
	"errors"
	"net/netip"
	"slices"
	"strings"
)

// Production for a staging deployment (Phase 18). ModeProduction stays refused, however complete the rest, unless the
// deployment opts in explicitly and exactly: AYA_AUTH_PROVIDER=standalone-gotrue, the self-hosted Supabase Auth (GoTrue)
// the Supabase verifier already verifies, and AYA_DEPLOYMENT_ENV=staging. There is no generic staging mode. Opted in,
// production takes the deploy modes' exact settings (loadDeploy) under stricter guards: public Host values and required
// https web origins by public DNS name, never an IP literal, loopback, local or test name; the trusted proxies as exact
// IP literals; and its own Auth by public name over https, at its root. Every other mode refuses these settings, even
// empty, instead of ignoring them.
const (
	// EnvAuthProvider names production's Auth provider. The one supported is the deployment's standalone GoTrue.
	EnvAuthProvider = "AYA_AUTH_PROVIDER"
	// EnvDeployment names production's deployment. The one supported is staging.
	EnvDeployment = "AYA_DEPLOYMENT_ENV"
	// EnvTrustedProxies lists, in production, the exact addresses of the TLS-terminating proxies in front of the service:
	// canonical unicast IP literals (isTrustedProxy), without CIDR, wildcard, host name or port.
	EnvTrustedProxies = "AYA_TRUSTED_PROXIES"
)

// The exact opt-in values, and the one explicit port production's Auth URL may name: the TLS proxy's private listener
// for the verifier's and the admin calls.
const (
	authProviderStandaloneGoTrue = "standalone-gotrue"
	deploymentStaging            = "staging"
	stagingAuthPort              = "9443"
)

// ErrNotPublicAuth reports, in production, a Supabase Auth URL that is not exactly Auth's https root by its own public
// DNS name (isStagingAuthURL).
var ErrNotPublicAuth = errors.New("config: the Supabase Auth URL must be exactly https:// and Auth's own lowercase public DNS name, optionally with the private port :9443, and nothing more: no IP literal, local or test name, userinfo, path, trailing slash, query or fragment")

// stagingSettings are production's own settings, which every other mode refuses, even empty.
var stagingSettings = []string{EnvAuthProvider, EnvDeployment, EnvTrustedProxies}

// nonPublicTLDs are top-level names that never resolve in the public DNS: the special-use names (localhost, local, test,
// invalid, example, onion, alt and the arpa infrastructure, home.arpa included), ICANN's private-use internal, and the
// private names in common use (RFC 6762, appendix G, and localdomain).
var nonPublicTLDs = []string{
	"localhost", "local", "test", "invalid", "example", "onion", "alt", "arpa", "internal", "intranet", "private", "corp",
	"home", "lan", "localdomain",
}

// stagingOptedIn reports whether production's opt-in is given exactly: both settings, each spelled exactly.
func stagingOptedIn(get func(string) string) bool {
	return get(EnvAuthProvider) == authProviderStandaloneGoTrue && get(EnvDeployment) == deploymentStaging
}

// loadStagingAuth reads production's Auth: its https root by public name, then the exact issuer and audience of its
// tokens and the admin credential from its private file, as the local modes read them (loadAuthTrust). It takes no
// stack-internal host list. Each refusal names its variable only.
func loadStagingAuth(get func(string) string) (Supabase, error) {
	s := Supabase{URL: get(EnvSupabaseURL)}
	switch {
	case s.URL == "":
		return Supabase{}, refuse(ErrMissing, EnvSupabaseURL)
	case !isStagingAuthURL(s.URL):
		return Supabase{}, refuse(ErrNotPublicAuth, EnvSupabaseURL)
	}
	return loadAuthTrust(get, s)
}

// isStagingAuthURL accepts, byte for byte, "https://", a public DNS name (isPublicHostName) and optionally ":9443", and
// nothing more. As the host must be a lowercase DNS name and the only port 9443, no path (a trailing slash included),
// userinfo, query, fragment, escape, space, control byte, backslash or upper case can pass. The Supabase verifier then
// applies its own URL guards as well.
func isStagingAuthURL(raw string) bool {
	rest, ok := strings.CutPrefix(raw, "https://")
	if !ok {
		return false
	}
	host, port, hasPort := strings.Cut(rest, ":")
	return isPublicHostName(host) && (!hasPort || port == stagingAuthPort)
}

// isPublicHost accepts a public Host value: a public DNS name (isPublicHostName) with an optional port.
func isPublicHost(s string) bool {
	host, _, ok := splitHost(s)
	return ok && isPublicHostName(host)
}

// isPublicWebOrigin accepts an exact https origin, as isWebOrigin does, whose host is a public DNS name
// (isPublicHostName).
func isPublicWebOrigin(s string) bool {
	rest, ok := strings.CutPrefix(s, "https://")
	if !ok {
		return false
	}
	host, port, ok := splitHost(rest)
	return ok && port != "443" && isPublicHostName(host)
}

// isTrustedProxy accepts a proxy's exact address: a canonical IP literal (isIPLiteral) that a peer can connect from,
// neither unspecified, loopback, multicast, link-local nor the IPv4 broadcast address.
func isTrustedProxy(s string) bool {
	a, err := netip.ParseAddr(s)
	return err == nil && isIPLiteral(s) && a.IsGlobalUnicast()
}

// isPublicHostName accepts a lowercase DNS name (isHostName) that can resolve in the public DNS: two labels at least,
// the top-level one with a letter, so never an IP-like name, and outside nonPublicTLDs. It resolves nothing.
func isPublicHostName(s string) bool {
	dot := strings.LastIndexByte(s, '.')
	if dot < 0 || !isHostName(s) {
		return false
	}
	tld := s[dot+1:]
	hasLetter := strings.ContainsFunc(tld, func(r rune) bool { return r >= 'a' && r <= 'z' })
	return hasLetter && !slices.Contains(nonPublicTLDs, tld)
}
