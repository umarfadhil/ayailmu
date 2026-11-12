package httpapi

import (
	"net/http"
	"net/netip"
	"slices"
)

// probePaths are the routes of the container's own loopback health probe: in production, the only ones a
// loopback peer may ask, with GET only.
var probePaths = []string{"/v1/healthz", "/v1/readyz"}

// admitted is the first guard, answered with the Host refusal (421) before CORS and authentication, so a
// refused request never reaches Auth or creates an account. Outside production it is the Host check alone.
//
// Production sits behind TLS-terminating proxies and trusts nothing else. Its remote address must be a
// canonical IP literal and a non-zero port (peerAddr). It admits a request from the exact address of one
// of its trusted proxies that says with exactly one X-Forwarded-Proto: https, in exact case, that its
// client used TLS, at one of its public Hosts, never a loopback one; an X-Forwarded-Host, if any, must be
// exactly one and exactly that Host. The one other request admitted is the container's own loopback
// health probe: GET /v1/healthz or /v1/readyz from a loopback peer at a loopback Host it answers. Forwarded
// and X-Forwarded-For are never read, so no client can claim another address or scheme.
func (h *handler) admitted(r *http.Request) bool {
	if len(h.proxies) == 0 {
		return h.hostAllowed(r.Host)
	}
	peer, ok := peerAddr(r.RemoteAddr)
	if !ok || !h.hostAllowed(r.Host) {
		return false
	}
	if peer.IsLoopback() {
		return r.Method == http.MethodGet && slices.Contains(probePaths, r.URL.Path) && isLoopbackHost(r.Host)
	}
	if !slices.Contains(h.proxies, peer.String()) || isLoopbackHost(r.Host) {
		return false
	}
	proto, forwardedHost := r.Header.Values("X-Forwarded-Proto"), r.Header.Values("X-Forwarded-Host")
	return len(proto) == 1 && proto[0] == "https" &&
		(len(forwardedHost) == 0 || (len(forwardedHost) == 1 && forwardedHost[0] == r.Host))
}

// peerAddr reads a remote address strictly, as the server writes it: a canonical IP literal without a
// zone or IPv4 mapping, and a non-zero port ("10.30.0.2:41234", "[fd00:30::2]:41234"). Anything else, an
// empty or missing port, brackets around IPv4 or another spelling included, is no address.
func peerAddr(remote string) (netip.Addr, bool) {
	ap, err := netip.ParseAddrPort(remote)
	if err != nil || ap.Port() == 0 || ap.String() != remote {
		return netip.Addr{}, false
	}
	if a := ap.Addr(); a.Zone() == "" && !a.Is4In6() {
		return a, true
	}
	return netip.Addr{}, false
}

// isLoopbackHost reports whether a Host value is a loopback address and port: the container's own
// loopback probe, which only a loopback peer may use.
func isLoopbackHost(host string) bool {
	ap, err := netip.ParseAddrPort(host)
	return err == nil && ap.Addr().IsLoopback()
}
