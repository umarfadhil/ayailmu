package httpapi

import (
	"net/http"
	"slices"
	"strings"
)

// Media types and body limits of the body routes (contract §2).
const (
	mediaJSON       = "application/json"
	mediaMergePatch = "application/merge-patch+json"

	maxEventsBody = 4 << 20
	maxImportBody = 16 << 20
	maxPatchBody  = 16 << 10
)

// pidSegment marks the profile ID segment. Any non-empty segment matches: the profile routes resolve
// it against the caller's account, so a malformed ID, a missing profile and another account's profile
// all end in the same 404.
const pidSegment = "{pid}"

// handlerFunc serves one method of a route after the guards.
type handlerFunc func(w http.ResponseWriter, r *http.Request, c *call)

// call carries what the guards established.
type call struct {
	accountID string // empty only on the public route
	profileID string // the raw {pid} segment; the profile routes resolve it against the account
	body      []byte // the exact body of a body route, syntactically valid JSON
}

// endpoint is one method of a route. A non-empty mediaType means the method takes a body of that
// media type and at most maxBytes bytes.
type endpoint struct {
	mediaType string
	maxBytes  int64
	serve     handlerFunc
}

type route struct {
	segs    []string
	public  bool
	methods map[string]endpoint
	allow   string // the methods, sorted and comma-separated, for the Allow header
}

func (h *handler) routeTable() []*route {
	read := func(serve handlerFunc) endpoint { return endpoint{serve: serve} }
	write := func(mediaType string, maxBytes int64, serve handlerFunc) endpoint {
		return endpoint{mediaType: mediaType, maxBytes: maxBytes, serve: serve}
	}
	routes := []*route{
		{segs: []string{"v1", "healthz"}, public: true, methods: map[string]endpoint{http.MethodGet: read(h.health)}},
		{segs: []string{"v1", "me"}, methods: map[string]endpoint{http.MethodGet: read(h.me)}},
		{segs: []string{"v1", "curricula"}, methods: map[string]endpoint{http.MethodGet: read(h.curricula)}},
		{segs: []string{"v1", "imports"}, methods: map[string]endpoint{http.MethodPost: write(mediaJSON, maxImportBody, h.importGuest)}},
		{segs: []string{"v1", "profiles", pidSegment}, methods: map[string]endpoint{
			http.MethodGet:   read(h.getProfile),
			http.MethodPatch: write(mediaMergePatch, maxPatchBody, h.patchProfile),
		}},
		{segs: []string{"v1", "profiles", pidSegment, "events"}, methods: map[string]endpoint{
			http.MethodGet:  read(h.pullEvents),
			http.MethodPost: write(mediaJSON, maxEventsBody, h.postEvents),
		}},
		{segs: []string{"v1", "profiles", pidSegment, "progress"}, methods: map[string]endpoint{http.MethodGet: read(h.progress)}},
	}
	for _, rt := range routes {
		methods := make([]string, 0, len(rt.methods))
		for m := range rt.methods {
			methods = append(methods, m)
		}
		slices.Sort(methods)
		rt.allow = strings.Join(methods, ", ")
	}
	return routes
}

// match finds the route of a request path and returns its {pid} segment, if it has one.
func (h *handler) match(path string) (*route, string) {
	rest, ok := strings.CutPrefix(path, "/")
	if !ok {
		return nil, ""
	}
	segs := strings.Split(rest, "/")
	for _, rt := range h.routes {
		if pid, ok := rt.matches(segs); ok {
			return rt, pid
		}
	}
	return nil, ""
}

func (rt *route) matches(segs []string) (string, bool) {
	if len(segs) != len(rt.segs) {
		return "", false
	}
	pid := ""
	for i, want := range rt.segs {
		switch {
		case want == pidSegment:
			if segs[i] == "" {
				return "", false
			}
			pid = segs[i]
		case segs[i] != want:
			return "", false
		}
	}
	return pid, true
}
