// Package httpapi serves the local v1 API described in backend/docs/Backend_Local_Contract.md: Host
// allow-list, a CORS gate for the local web app (or a deploy mode's exact origins), bearer
// authentication, the deleted-account gate, typed and bounded bodies, RFC 9457 problems, Cache-Control:
// no-store, and the account, account export and deletion, profile, import, event, pull, progress and
// curriculum routes. A deploy mode also asks browsers to keep to HTTPS and serves public readiness;
// production also admits requests only through its trusted proxy over HTTPS.
package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"slices"
	"time"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/store"
)

// hstsPolicy asks browsers, in a deploy mode, to reach the service's front over HTTPS only, for a day:
// enough to protect a session, short enough that a local synthetic stack's names are soon released.
const hstsPolicy = "max-age=86400"

// Deps are the handler's collaborators.
type Deps struct {
	// Mode is the configured mode: health reports it.
	Mode string
	// AccountMode is the auth_mode an account created on first use records: the kind of provider that
	// verified it (config.ModeEmulator or config.ModeLocalSupabase, which local-compose's local synthetic
	// Supabase Auth also is). Empty means Mode.
	AccountMode  string
	AllowedHosts []string
	// TrustedProxies are, in production, the exact addresses of the TLS-terminating proxies in front of
	// the service, as canonical IP literals (config.Config's TrustedProxies). With them the admission gate
	// (admitted) replaces the bare Host check. Nil in every other mode.
	TrustedProxies []string
	// Deploy marks a deploy mode (config.ModeDeploySmoke or config.ModeLocalCompose) or production: the CORS
	// gate grants exactly CORSOrigins instead of the local web preview, every answer asks browsers to keep
	// to HTTPS, and the public readiness route GET /v1/readyz is served.
	Deploy bool
	// CORSOrigins are a deploy mode's exact https web origins; none means native clients only. The
	// loopback modes ignore them.
	CORSOrigins []string
	// Verifier authenticates every request. When it is also an authn.SessionVerifier, requests carry
	// the verified sign-in time and the account export is served; otherwise the account controls are
	// not served at all (404), so they fail closed.
	Verifier authn.Verifier
	// IdentityDeleter deletes the caller's identity-provider account once its server data is erased.
	// The deletion routes are served only with it and a session-capable Verifier.
	IdentityDeleter authn.IdentityDeleter
	Store           *store.Store
	Registry        *curriculum.Registry
	// ExportMaxBytes is the largest account export served, in encoded bytes (config.Config's
	// ExportMaxBytes). It must be positive.
	ExportMaxBytes int
	// BeforeCommit and BeforeIdentityDeletion are the test seams documented on server.Options; nil in
	// production.
	BeforeCommit           func(ctx context.Context)
	BeforeIdentityDeletion func(ctx context.Context) error
	// Now is the clock of the recent sign-in check (server.Options.Now); nil means time.Now.
	Now func() time.Time
	// Logger receives failures as fixed messages, deletion IDs and error classes, never tokens,
	// subjects, connection strings, provider messages or request content. Nil means slog.Default().
	Logger *slog.Logger
}

type handler struct {
	mode                   string
	accountMode            string
	hosts                  []string
	proxies                []string // production's trusted proxy addresses; nil elsewhere
	deploy                 bool
	origins                []string // the exact web origins the CORS gate grants
	verifier               authn.Verifier
	sessions               authn.SessionVerifier // nil when the verifier cannot report sign-in times
	deleter                authn.IdentityDeleter
	store                  *store.Store
	registry               *curriculum.Registry
	exportMax              int
	beforeCommit           func(ctx context.Context)
	beforeIdentityDeletion func(ctx context.Context) error
	now                    func() time.Time
	log                    *slog.Logger
	routes                 []*route
}

// New returns the v1 handler. Verifier, Store, Registry and a positive ExportMaxBytes are required.
func New(d Deps) http.Handler {
	if d.Verifier == nil || d.Store == nil || d.Registry == nil || d.ExportMaxBytes <= 0 {
		panic("httpapi: Verifier, Store, Registry and ExportMaxBytes are required")
	}
	sessions, _ := d.Verifier.(authn.SessionVerifier)
	accountMode, origins := d.AccountMode, webOrigins
	if accountMode == "" {
		accountMode = d.Mode
	}
	if d.Deploy {
		origins = slices.Clone(d.CORSOrigins)
	}
	h := &handler{
		mode:                   d.Mode,
		accountMode:            accountMode,
		hosts:                  slices.Clone(d.AllowedHosts),
		proxies:                slices.Clone(d.TrustedProxies),
		deploy:                 d.Deploy,
		origins:                origins,
		verifier:               d.Verifier,
		sessions:               sessions,
		deleter:                d.IdentityDeleter,
		store:                  d.Store,
		registry:               d.Registry,
		exportMax:              d.ExportMaxBytes,
		beforeCommit:           d.BeforeCommit,
		beforeIdentityDeletion: d.BeforeIdentityDeletion,
		now:                    d.Now,
		log:                    d.Logger,
	}
	if h.log == nil {
		h.log = slog.Default()
	}
	if h.now == nil {
		h.now = time.Now
	}
	h.routes = h.routeTable()
	return h
}

// ServeHTTP applies the guards in the documented order (contract §2): Host (in production, the
// admission gate, which includes it); the CORS gate, which answers preflights; authentication on every
// route but health (and a deploy mode's readiness); the deleted-account gate; route; method; then, for
// body routes, media type, size and JSON syntax. The route's own checks follow in its handler.
func (h *handler) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	w := &responseWriter{ResponseWriter: rw}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if h.deploy {
		w.Header().Set("Strict-Transport-Security", hstsPolicy)
	}
	defer h.recoverPanic(w)

	if !h.admitted(r) {
		writeProblem(w, newProblem(http.StatusMisdirectedRequest, codeHostNotAllowed, "this service does not answer to the request's Host"))
		return
	}
	if h.cors(w, r) {
		return
	}
	rt, pid := h.match(r.URL.Path)
	c := &call{profileID: pid}
	if rt == nil || !rt.public {
		who, err := h.authenticate(r)
		if errors.Is(err, errUnauthenticated) {
			writeUnauthenticated(w)
			return
		}
		if err != nil {
			h.internal(w, "authenticate", err)
			return
		}
		// A deleted account gets the same 410 everywhere but its deletion's own route: an old token, a
		// new sign-in of the same identity or a replayed upload brings nothing back (contract §13).
		if who.deleted && (rt == nil || !rt.allowDeleted) {
			writeAccountDeleted(w)
			return
		}
		c.caller = who
	}
	if rt == nil {
		writeNotFound(w)
		return
	}
	ep, ok := rt.methods[r.Method]
	if !ok {
		w.Header().Set("Allow", rt.allow)
		writeProblem(w, newProblem(http.StatusMethodNotAllowed, codeMethodNotAllowed, "the route does not support this method"))
		return
	}
	if ep.mediaType != "" {
		// The server's own writer, so an oversized body also closes the connection.
		body, p := readBody(rw, r, ep.mediaType, ep.maxBytes)
		if p != nil {
			writeProblem(w, p)
			return
		}
		c.body = body
	}
	ep.serve(w, r, c)
}

// internal logs a failure by class only and answers with the generic 500 problem.
func (h *handler) internal(w http.ResponseWriter, op string, err error) {
	h.log.Error("httpapi: request failed", "op", op, "error_class", store.ErrorClass(err))
	writeProblem(w, internalProblem())
}

// recoverPanic turns a handler panic into the generic 500 problem when nothing was written yet. The
// panic value is not logged because it could quote request content; the stack holds code locations.
func (h *handler) recoverPanic(w *responseWriter) {
	v := recover()
	if v == nil {
		return
	}
	if v == http.ErrAbortHandler {
		panic(v)
	}
	h.log.Error("httpapi: handler panic", "panic_type", fmt.Sprintf("%T", v), "stack", string(debug.Stack()))
	if !w.started {
		writeProblem(w, internalProblem())
	}
}

// responseWriter records whether the response has started.
type responseWriter struct {
	http.ResponseWriter
	started bool
}

func (w *responseWriter) WriteHeader(status int) {
	w.started = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseWriter) Write(b []byte) (int, error) {
	w.started = true
	return w.ResponseWriter.Write(b)
}
