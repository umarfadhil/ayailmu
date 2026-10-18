// Package httpapi serves the local v1 API described in backend/docs/Backend_Local_Contract.md: Host
// allow-list, a CORS gate for the local web app, bearer authentication, typed and bounded bodies, RFC
// 9457 problems, Cache-Control: no-store, and the account, profile, import, event, pull, progress and
// curriculum routes.
package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"slices"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/store"
)

// Deps are the handler's collaborators.
type Deps struct {
	Mode         string
	AllowedHosts []string
	Verifier     authn.Verifier
	Store        *store.Store
	Registry     *curriculum.Registry
	// BeforeCommit is the test seam documented on server.Options; nil in production.
	BeforeCommit func(ctx context.Context)
	// Logger receives failures as fixed messages and error classes, never tokens, connection strings
	// or request content. Nil means slog.Default().
	Logger *slog.Logger
}

type handler struct {
	mode         string
	hosts        []string
	verifier     authn.Verifier
	store        *store.Store
	registry     *curriculum.Registry
	beforeCommit func(ctx context.Context)
	log          *slog.Logger
	routes       []*route
}

// New returns the v1 handler. Verifier, Store and Registry are required.
func New(d Deps) http.Handler {
	if d.Verifier == nil || d.Store == nil || d.Registry == nil {
		panic("httpapi: Verifier, Store and Registry are required")
	}
	h := &handler{
		mode:         d.Mode,
		hosts:        slices.Clone(d.AllowedHosts),
		verifier:     d.Verifier,
		store:        d.Store,
		registry:     d.Registry,
		beforeCommit: d.BeforeCommit,
		log:          d.Logger,
	}
	if h.log == nil {
		h.log = slog.Default()
	}
	h.routes = h.routeTable()
	return h
}

// ServeHTTP applies the guards in the documented order (contract §2): Host; the CORS gate, which answers
// preflights; authentication on every route but health; route; method; then, for body routes, media
// type, size and JSON syntax. The route's own checks follow in its handler.
func (h *handler) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	w := &responseWriter{ResponseWriter: rw}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	defer h.recoverPanic(w)

	if !h.hostAllowed(r.Host) {
		writeProblem(w, newProblem(http.StatusMisdirectedRequest, codeHostNotAllowed, "this service does not answer to the request's Host"))
		return
	}
	if h.cors(w, r) {
		return
	}
	rt, pid := h.match(r.URL.Path)
	c := &call{profileID: pid}
	if rt == nil || !rt.public {
		accountID, err := h.authenticate(r)
		if errors.Is(err, errUnauthenticated) {
			writeUnauthenticated(w)
			return
		}
		if err != nil {
			h.internal(w, "authenticate", err)
			return
		}
		c.accountID = accountID
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
