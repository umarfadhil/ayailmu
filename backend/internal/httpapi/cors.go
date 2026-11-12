package httpapi

import (
	"net/http"
	"slices"
	"strings"
)

// webOrigins are the only cross-origin callers the loopback modes answer: the local Expo web preview,
// under both loopback names. A deploy mode answers exactly its configured https origins instead, and none
// of these. Nothing else ever gets a grant, there is no wildcard, and credentials are never allowed: the
// API takes bearer tokens, not cookies.
var webOrigins = []string{"http://localhost:8087", "http://127.0.0.1:8087"}

// corsRequestHeaders are the request headers a preflight may ask for, lowercased.
var corsRequestHeaders = []string{"authorization", "content-type", "if-match"}

const (
	// corsAllowHeaders is the one list a granted preflight names; it never echoes the request.
	corsAllowHeaders = "Authorization, Content-Type, If-Match"
	corsMaxAge       = "600"
)

// cors is the CORS gate. It runs after the Host guard and before authentication, and reports whether it
// answered the request.
//
// A preflight is an OPTIONS request with an Origin and an Access-Control-Request-Method header, even an
// empty one; headers are checked for presence, not just for a value. The gate answers it: 204 with an
// exact grant when a web origin asks for a known route, one of the route's methods and only request
// headers the API uses; otherwise a fixed 403 that grants nothing and quotes nothing from the request.
//
// Any other request goes on through the usual guards, so a bearer token is still required and the 401
// is unchanged. When it comes from a web origin, every answer, errors included, carries the exact origin
// and exposes ETag, so the web app can read 401, 412 and 428 bodies and make conditional requests. A
// missing or unlisted origin changes nothing.
func (h *handler) cors(w http.ResponseWriter, r *http.Request) bool {
	origins := r.Header.Values("Origin")
	if len(origins) == 0 {
		return false
	}
	allowed := len(origins) == 1 && slices.Contains(h.origins, origins[0])
	hdr := w.Header()
	methods := r.Header.Values("Access-Control-Request-Method")
	if r.Method != http.MethodOptions || len(methods) == 0 {
		if allowed {
			hdr.Set("Access-Control-Allow-Origin", origins[0])
			hdr.Add("Vary", "Origin")
			hdr.Set("Access-Control-Expose-Headers", "ETag")
		}
		return false
	}
	hdr.Add("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
	if !allowed {
		writeProblem(w, newProblem(http.StatusForbidden, codeOriginNotAllowed, h.originRefusal()))
		return true
	}
	rt, _ := h.match(r.URL.Path)
	if rt == nil || len(methods) != 1 || !requestHeadersAllowed(r.Header.Values("Access-Control-Request-Headers")) {
		writeProblem(w, invalidPreflight())
		return true
	}
	if _, ok := rt.methods[methods[0]]; !ok {
		writeProblem(w, invalidPreflight())
		return true
	}
	hdr.Set("Access-Control-Allow-Origin", origins[0])
	hdr.Set("Access-Control-Allow-Methods", rt.allow)
	hdr.Set("Access-Control-Allow-Headers", corsAllowHeaders)
	hdr.Set("Access-Control-Max-Age", corsMaxAge)
	w.WriteHeader(http.StatusNoContent)
	return true
}

// originRefusal is the fixed detail of the 403 for an origin the gate does not grant.
func (h *handler) originRefusal() string {
	if h.deploy {
		return "only this deployment's web app may make cross-origin requests to this service"
	}
	return "only the local web app may make cross-origin requests to this service"
}

func invalidPreflight() *problem {
	return newProblem(http.StatusForbidden, codeInvalidPreflight,
		"a preflight must ask for a known route, one of its methods in exact case, and only the Authorization, Content-Type and If-Match request headers")
}

// requestHeadersAllowed checks Access-Control-Request-Headers: comma-separated names, in any case, each
// one the API uses.
func requestHeadersAllowed(values []string) bool {
	for _, v := range values {
		for _, name := range strings.Split(v, ",") {
			if name = strings.ToLower(strings.TrimSpace(name)); name != "" && !slices.Contains(corsRequestHeaders, name) {
				return false
			}
		}
	}
	return true
}
