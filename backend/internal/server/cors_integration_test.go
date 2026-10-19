//go:build firebase_emulator

package server_test

import (
	"bytes"
	"net/http"
	"slices"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/server"
)

// The local web app, the Expo web preview on port 8087, is the only cross-origin caller the API answers.
const (
	webOriginLocalhost = "http://localhost:8087"
	webOriginLoopback  = "http://127.0.0.1:8087"
	// corsAllowHeaders is the one request-header list a granted preflight names, never an echo of what
	// the request asked for.
	corsAllowHeaders = "Authorization, Content-Type, If-Match"
	// Markers a refusal must never quote back.
	unlistedOrigin = "http://aya-unlisted-origin.example"
	unlistedHeader = "x-aya-unlisted-header"
)

var webOrigins = []string{webOriginLocalhost, webOriginLoopback}

// preflight sends a CORS preflight as a browser does: OPTIONS with Origin and the requested method, the
// requested headers when headers is not empty, and no token.
func (s *stack) preflight(t *testing.T, path, origin, method, headers string, extra ...string) reply {
	t.Helper()
	hdr := []string{"Origin", origin, "Access-Control-Request-Method", method}
	if headers != "" {
		hdr = append(hdr, "Access-Control-Request-Headers", headers)
	}
	return s.call(t, http.MethodOptions, path, "", nil, append(hdr, extra...)...)
}

// headerTokens returns the comma-separated tokens of every value of a header, trimmed and lowercased.
func headerTokens(h http.Header, name string) []string {
	var out []string
	for _, v := range h.Values(name) {
		for _, tok := range strings.Split(v, ",") {
			if tok = strings.ToLower(strings.TrimSpace(tok)); tok != "" {
				out = append(out, tok)
			}
		}
	}
	return out
}

// mentions reports whether a response quotes marker anywhere, in its body or a header, in any case.
func mentions(r reply, marker string) bool {
	marker = strings.ToLower(marker)
	if bytes.Contains(bytes.ToLower(r.body), []byte(marker)) {
		return true
	}
	for _, values := range r.header {
		for _, v := range values {
			if strings.Contains(strings.ToLower(v), marker) {
				return true
			}
		}
	}
	return false
}

// wantNoCORSGrant checks that a response grants no cross-origin access at all.
func wantNoCORSGrant(t *testing.T, r reply) {
	t.Helper()
	for _, name := range []string{"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers", "Access-Control-Expose-Headers"} {
		if v := r.header.Values(name); len(v) != 0 {
			t.Fatalf("%s = %q, want no cross-origin grant", name, v)
		}
	}
}

// wantCORSGrant checks an ordinary response to an allowed origin: the exact origin, never credentials,
// Vary on Origin, and ETag exposed so the web app can make conditional profile requests.
func wantCORSGrant(t *testing.T, r reply, origin string) {
	t.Helper()
	if got := r.header.Values("Access-Control-Allow-Origin"); len(got) != 1 || got[0] != origin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want exactly %q", got, origin)
	}
	if v := r.header.Values("Access-Control-Allow-Credentials"); len(v) != 0 {
		t.Fatalf("Access-Control-Allow-Credentials = %q, want none: the API takes bearer tokens, never cookies", v)
	}
	if !slices.Contains(headerTokens(r.header, "Vary"), "origin") {
		t.Fatalf("Vary = %q, want it to name Origin", r.header.Values("Vary"))
	}
	if !slices.Contains(headerTokens(r.header, "Access-Control-Expose-Headers"), "etag") {
		t.Fatalf("Access-Control-Expose-Headers = %q, want ETag exposed", r.header.Values("Access-Control-Expose-Headers"))
	}
}

// wantPreflightGrant checks a granted preflight: 204 without a body, the exact origin, the route's
// methods, the fixed request-header list, no credentials, and Vary on every request header the answer
// depends on.
func wantPreflightGrant(t *testing.T, r reply, origin, methods string) {
	t.Helper()
	if r.status != http.StatusNoContent || len(r.body) != 0 {
		t.Fatalf("preflight = %d with %d body bytes, want 204 without a body (%.300q)", r.status, len(r.body), r.body)
	}
	if got := r.header.Values("Access-Control-Allow-Origin"); len(got) != 1 || got[0] != origin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want exactly %q", got, origin)
	}
	if v := r.header.Values("Access-Control-Allow-Credentials"); len(v) != 0 {
		t.Fatalf("Access-Control-Allow-Credentials = %q, want none", v)
	}
	if got := r.header.Values("Access-Control-Allow-Methods"); len(got) != 1 || got[0] != methods {
		t.Fatalf("Access-Control-Allow-Methods = %q, want exactly %q", got, methods)
	}
	if got := r.header.Values("Access-Control-Allow-Headers"); len(got) != 1 || got[0] != corsAllowHeaders {
		t.Fatalf("Access-Control-Allow-Headers = %q, want exactly %q", got, corsAllowHeaders)
	}
	vary := headerTokens(r.header, "Vary")
	for _, name := range []string{"origin", "access-control-request-method", "access-control-request-headers"} {
		if !slices.Contains(vary, name) {
			t.Fatalf("Vary = %q, want it to name %s", r.header.Values("Vary"), name)
		}
	}
	if got := r.header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}

// wantPreflightRefused checks a refused preflight: a fixed 403 problem that grants nothing.
func wantPreflightRefused(t *testing.T, r reply, code string) {
	t.Helper()
	wantProblem(t, r, http.StatusForbidden, code)
	wantNoCORSGrant(t, r)
}

// Preflights: the Host guard runs first; the local web app's two origins get exact grants for real
// routes and methods with the three request headers the API uses; every other preflight gets a fixed 403
// and no grant; OPTIONS that is not a preflight is left to the existing guards.
func TestCORSPreflightGrantsOnlyTheLocalWebApp(t *testing.T) {
	s := newStack(t, server.Options{})
	// A preflight carries no token, so only the route's shape counts: any profile ID will do.
	const pid = "0b7e0f3c-5f6a-4d8e-9a1b-2c3d4e5f6a7b"

	t.Run("the Host guard runs first", func(t *testing.T) {
		for _, host := range []string{"evil.example", "localhost:8087"} {
			r := s.preflight(t, "/v1/me", webOriginLocalhost, http.MethodGet, "authorization", "Host", host)
			wantProblem(t, r, http.StatusMisdirectedRequest, "host_not_allowed")
			wantNoCORSGrant(t, r)
			r = s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", host, "Origin", webOriginLoopback)
			wantProblem(t, r, http.StatusMisdirectedRequest, "host_not_allowed")
			wantNoCORSGrant(t, r)
		}
	})

	t.Run("the local web origins get exact grants for real routes and methods", func(t *testing.T) {
		for _, c := range []struct{ path, method, headers, allow string }{
			{"/v1/healthz", "GET", "", "GET"},
			{"/v1/me", "GET", "authorization", "GET"},
			{"/v1/curricula", "GET", "authorization", "GET"},
			{"/v1/imports", "POST", "authorization,content-type", "POST"},
			{"/v1/profiles/" + pid, "GET", "authorization", "GET, PATCH"},
			{"/v1/profiles/" + pid, "PATCH", "authorization,content-type,if-match", "GET, PATCH"},
			{"/v1/profiles/" + pid + "/events", "GET", "AUTHORIZATION", "GET, POST"},
			{"/v1/profiles/" + pid + "/events", "POST", "Authorization, Content-Type", "GET, POST"},
			{"/v1/profiles/" + pid + "/progress", "GET", "authorization", "GET"},
		} {
			for _, origin := range webOrigins {
				t.Run(origin+" "+c.method+" "+c.path, func(t *testing.T) {
					wantPreflightGrant(t, s.preflight(t, c.path, origin, c.method, c.headers), origin, c.allow)
				})
			}
		}
	})

	t.Run("other origins are refused without a grant", func(t *testing.T) {
		for _, origin := range []string{unlistedOrigin, "http://localhost:8086", "http://localhost:8088", "http://127.0.0.1:8085",
			"https://localhost:8087", "http://localhost:8087.evil.example", "http://evil.localhost:8087", "http://localhost:8087/",
			"HTTP://LOCALHOST:8087", "null"} {
			t.Run(origin, func(t *testing.T) {
				r := s.preflight(t, "/v1/me", origin, http.MethodGet, "authorization")
				wantPreflightRefused(t, r, "origin_not_allowed")
				if mentions(r, "aya-unlisted-origin") {
					t.Fatal("the refusal quotes the request's Origin")
				}
			})
		}
	})

	t.Run("the local web origins asking for anything else are refused without a grant", func(t *testing.T) {
		for _, c := range []struct{ name, path, method, headers string }{
			{"an unknown route", "/v1/nope", "GET", "authorization"},
			{"an unknown profile route", "/v1/profiles/" + pid + "/snapshot", "GET", "authorization"},
			{"another API version", "/v2/me", "GET", "authorization"},
			{"a deferred feature", "/v1/support/products", "GET", "authorization"},
			{"a method the route lacks", "/v1/me", "DELETE", "authorization"},
			{"PUT on a profile", "/v1/profiles/" + pid, "PUT", "authorization,content-type"},
			{"GET on imports", "/v1/imports", "GET", "authorization"},
			{"a method in lowercase", "/v1/profiles/" + pid, "patch", "authorization,content-type,if-match"},
			{"an empty method", "/v1/me", "", "authorization"},
			{"an unlisted request header", "/v1/me", "GET", "authorization," + unlistedHeader},
		} {
			for _, origin := range webOrigins {
				t.Run(c.name+" from "+origin, func(t *testing.T) {
					r := s.preflight(t, c.path, origin, c.method, c.headers)
					wantPreflightRefused(t, r, "invalid_preflight")
					if mentions(r, unlistedHeader) {
						t.Fatal("the refusal quotes a requested header")
					}
				})
			}
		}
	})

	t.Run("OPTIONS that is not a preflight keeps the existing guards", func(t *testing.T) {
		u := newUser(t, s.emu)
		canonical := s.call(t, http.MethodGet, "/v1/me", "", nil)
		wantProblem(t, canonical, http.StatusUnauthorized, "unauthenticated")
		for _, hdr := range [][]string{nil, {"Access-Control-Request-Method", "GET"}} {
			r := s.call(t, http.MethodOptions, "/v1/me", "", nil, hdr...)
			wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
			if !bytes.Equal(r.body, canonical.body) {
				t.Fatal("the 401 for OPTIONS without an Origin differs from the uniform 401")
			}
			wantNoCORSGrant(t, r)
		}
		r := s.call(t, http.MethodOptions, "/v1/me", u.token, nil)
		wantProblem(t, r, http.StatusMethodNotAllowed, "method_not_allowed")
		if got := r.header.Get("Allow"); got != "GET" {
			t.Fatalf("Allow = %q, want GET", got)
		}
		wantNoCORSGrant(t, r)
		// From an allowed origin but without a requested method it is an ordinary request: the same
		// guards, plus the grant that lets the web app read the answer.
		r = s.call(t, http.MethodOptions, "/v1/me", "", nil, "Origin", webOriginLocalhost)
		wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
		if !bytes.Equal(r.body, canonical.body) {
			t.Fatal("the 401 for OPTIONS from the web app differs from the uniform 401")
		}
		wantCORSGrant(t, r, webOriginLocalhost)
	})
}

// Ordinary requests: the local web origins get the exact origin and ETag exposed on every answer, errors
// included, so the web app can read 401, 412 and 428 bodies; CORS never authenticates; other or missing
// origins change nothing and get no grant.
func TestCORSActualRequestsKeepAuthenticationAndExposeETag(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	pid := s.seedProfile(t, u, sourceRef{App: "expo", InstallID: "inst-cors-1", LocalProfileID: "lrn-cors-1"})
	canonical := s.call(t, http.MethodGet, "/v1/me", "", nil)
	wantProblem(t, canonical, http.StatusUnauthorized, "unauthenticated")

	t.Run("without an Origin nothing changes and nothing is granted", func(t *testing.T) {
		r := s.call(t, http.MethodGet, "/v1/me", u.token, nil)
		wantStatus(t, r, http.StatusOK)
		wantNoCORSGrant(t, r)
		wantNoCORSGrant(t, canonical)
	})

	t.Run("the local web origins read authenticated answers", func(t *testing.T) {
		for _, origin := range webOrigins {
			r := s.call(t, http.MethodGet, "/v1/me", u.token, nil, "Origin", origin)
			wantStatus(t, r, http.StatusOK)
			var m me
			decodeJSON(t, r.body, &m)
			if len(m.Profiles) != 1 || m.Profiles[0].ProfileID != pid {
				t.Fatalf("me = %+v, want the account's own profile", m)
			}
			wantCORSGrant(t, r, origin)
		}
	})

	t.Run("CORS never authenticates: the 401 stays uniform, and readable by the web app", func(t *testing.T) {
		for _, origin := range webOrigins {
			for _, hdr := range [][]string{{"Origin", origin}, {"Origin", origin, "Authorization", "Bearer not-a-jwt"}} {
				r := s.call(t, http.MethodGet, "/v1/me", "", nil, hdr...)
				wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
				if !bytes.Equal(r.body, canonical.body) || !strings.HasPrefix(r.header.Get("WWW-Authenticate"), "Bearer") {
					t.Fatal("the 401 from the web app differs from the uniform 401")
				}
				wantCORSGrant(t, r, origin)
			}
		}
	})

	t.Run("other origins get no grant and authentication is unchanged", func(t *testing.T) {
		for _, origin := range []string{unlistedOrigin, "http://localhost:8086", "https://localhost:8087", "http://localhost:8087.evil.example", "null"} {
			r := s.call(t, http.MethodGet, "/v1/me", u.token, nil, "Origin", origin)
			wantStatus(t, r, http.StatusOK)
			wantNoCORSGrant(t, r)
			r = s.call(t, http.MethodGet, "/v1/me", "", nil, "Origin", origin)
			wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
			if !bytes.Equal(r.body, canonical.body) {
				t.Fatalf("the 401 for Origin %q differs from the uniform 401", origin)
			}
			wantNoCORSGrant(t, r)
		}
	})

	t.Run("conditional profile requests expose ETag and keep their preconditions", func(t *testing.T) {
		path := "/v1/profiles/" + pid
		wantPreflightGrant(t, s.preflight(t, path, webOriginLoopback, http.MethodPatch, "authorization,content-type,if-match"),
			webOriginLoopback, "GET, PATCH")

		r := s.call(t, http.MethodGet, path, u.token, nil, "Origin", webOriginLoopback)
		wantStatus(t, r, http.StatusOK)
		if got := r.header.Get("ETag"); got != `"r1"` {
			t.Fatalf("ETag = %s, want \"r1\"", got)
		}
		wantCORSGrant(t, r, webOriginLoopback)

		patch := func(ifMatch string) reply {
			hdr := []string{"Origin", webOriginLocalhost, "Content-Type", "application/merge-patch+json"}
			if ifMatch != "" {
				hdr = append(hdr, "If-Match", ifMatch)
			}
			return s.call(t, http.MethodPatch, path, u.token, []byte(`{"settings":{"session_minutes":15}}`), hdr...)
		}
		r = patch("")
		wantProblem(t, r, http.StatusPreconditionRequired, "precondition_required")
		wantCORSGrant(t, r, webOriginLocalhost)

		r = patch(`"r7"`)
		p := wantProblem(t, r, http.StatusPreconditionFailed, "revision_conflict")
		var cur profileDoc
		decodeJSON(t, p.Current, &cur)
		if cur.Revision != 1 || r.header.Get("ETag") != `"r1"` {
			t.Fatalf("412 current revision %d (ETag %s), want 1", cur.Revision, r.header.Get("ETag"))
		}
		wantCORSGrant(t, r, webOriginLocalhost)

		r = patch(`"r1"`)
		wantStatus(t, r, http.StatusOK)
		var doc profileDoc
		decodeJSON(t, r.body, &doc)
		if doc.Revision != 2 || r.header.Get("ETag") != `"r2"` || val(doc.Settings.SessionMinutes) != 15 {
			t.Fatalf("patched profile = %+v (ETag %s), want revision 2 with 15 minutes", doc, r.header.Get("ETag"))
		}
		wantCORSGrant(t, r, webOriginLocalhost)
	})
}
