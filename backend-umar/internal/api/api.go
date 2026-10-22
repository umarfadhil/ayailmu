package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
)

type server struct {
	s *store.Store
	v *auth.Verifier
	r *catalog.Registry
}
type action func(http.ResponseWriter, *http.Request, auth.Principal)

func New(s *store.Store, v *auth.Verifier, r *catalog.Registry) http.Handler {
	a := &server{s, v, r}
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { write(w, 200, map[string]string{"status": "ok"}) })
	m.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if s.Ping(ctx) != nil {
			failure(w, 503, "database_unavailable")
			return
		}
		write(w, 200, map[string]string{"status": "ready"})
	})
	m.HandleFunc("POST /v1/account", a.secure(a.account))
	m.HandleFunc("GET /v1/account", a.secure(func(w http.ResponseWriter, r *http.Request, p auth.Principal) {
		if id, ok := a.owner(w, r, p); ok {
			write(w, 200, map[string]string{"account_id": id})
		}
	}))
	m.HandleFunc("POST /v1/learners", a.secure(a.createProfile))
	m.HandleFunc("GET /v1/learners", a.secure(a.profiles))
	m.HandleFunc("POST /v1/learners/{id}/consent", a.secure(a.consent))
	m.HandleFunc("POST /v1/learners/{id}/events", a.secure(a.append))
	m.HandleFunc("GET /v1/learners/{id}/events", a.secure(a.pull))
	m.HandleFunc("GET /v1/packs", a.secure(func(w http.ResponseWriter, r *http.Request, p auth.Principal) { write(w, 200, a.r) }))
	slots := make(chan struct{}, 64)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			failure(w, 503, "busy")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		m.ServeHTTP(w, r.WithContext(ctx))
	})
}
func (a *server) secure(next action) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		values := r.Header.Values("Authorization")
		if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") || strings.Count(values[0], " ") != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			failure(w, 401, "unauthorized")
			return
		}
		p, err := a.v.Verify(r.Context(), strings.TrimPrefix(values[0], "Bearer "))
		if err != nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			failure(w, 401, "unauthorized")
			return
		}
		next(w, r, p)
	}
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, status int, code string) {
	write(w, status, map[string]string{"error": code})
}
func problem(w http.ResponseWriter, e error) {
	switch {
	case errors.Is(e, store.ErrNotFound):
		failure(w, 404, "not_found")
	case errors.Is(e, store.ErrInvalid):
		failure(w, 400, "invalid_request")
	case errors.Is(e, store.ErrConflict):
		failure(w, 409, "idempotency_conflict")
	case errors.Is(e, store.ErrConsent):
		failure(w, 403, "sync_consent_required")
	case errors.Is(e, store.ErrAccount):
		failure(w, 403, "adult_owner_required")
	default:
		failure(w, 503, "service_unavailable")
	}
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		failure(w, 415, "json_required")
		return false
	}
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			failure(w, 413, "request_too_large")
		} else {
			failure(w, 400, "invalid_request")
		}
		return false
	}
	if native.Decode(b, v) != nil {
		failure(w, 400, "invalid_request")
		return false
	}
	return true
}
func fresh(w http.ResponseWriter, p auth.Principal) bool {
	if !p.Fresh(time.Now()) {
		failure(w, 403, "fresh_authentication_required")
		return false
	}
	return true
}
func (a *server) owner(w http.ResponseWriter, r *http.Request, p auth.Principal) (string, bool) {
	id, err := a.s.Account(r.Context(), p.Issuer, p.Subject)
	if err != nil {
		problem(w, err)
		return "", false
	}
	return id, true
}
func (a *server) account(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	var in struct {
		DeclarationVersion string `json:"declaration_version"`
		AdultConfirmed     bool   `json:"adult_confirmed"`
		Synthetic          bool   `json:"synthetic"`
	}
	if !decode(w, r, &in) || !fresh(w, p) {
		return
	}
	if !in.Synthetic || !in.AdultConfirmed || in.DeclarationVersion != "adult-owner-v1" {
		problem(w, store.ErrInvalid)
		return
	}
	id, err := a.s.Activate(r.Context(), p.Issuer, p.Subject)
	if err != nil {
		problem(w, err)
		return
	}
	write(w, 200, map[string]string{"account_id": id})
}
func (a *server) createProfile(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	var in store.ProfileInput
	if !decode(w, r, &in) || !fresh(w, p) {
		return
	}
	owner, ok := a.owner(w, r, p)
	if !ok {
		return
	}
	profile, err := a.s.CreateProfile(r.Context(), owner, in)
	if err != nil {
		problem(w, err)
		return
	}
	write(w, 200, profile)
}
func (a *server) profiles(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	owner, ok := a.owner(w, r, p)
	if !ok {
		return
	}
	profiles, err := a.s.Profiles(r.Context(), owner)
	if err != nil {
		problem(w, err)
		return
	}
	write(w, 200, profiles)
}
func (a *server) consent(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	var in struct {
		Version   string `json:"version"`
		Granted   *bool  `json:"granted"`
		Synthetic bool   `json:"synthetic"`
	}
	if !decode(w, r, &in) || !fresh(w, p) {
		return
	}
	if !in.Synthetic || in.Granted == nil {
		problem(w, store.ErrInvalid)
		return
	}
	owner, ok := a.owner(w, r, p)
	if !ok {
		return
	}
	if err := a.s.Consent(r.Context(), owner, r.PathValue("id"), *in.Granted, in.Version); err != nil {
		problem(w, err)
		return
	}
	write(w, 200, map[string]bool{"granted": *in.Granted})
}
func (a *server) append(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	var in struct {
		SchemaVersion int      `json:"schema_version"`
		Synthetic     bool     `json:"synthetic"`
		Events        []string `json:"events"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.SchemaVersion != 1 || !in.Synthetic {
		problem(w, store.ErrInvalid)
		return
	}
	owner, ok := a.owner(w, r, p)
	if !ok {
		return
	}
	receipts, err := a.s.Append(r.Context(), owner, r.PathValue("id"), in.Events)
	if err != nil {
		problem(w, err)
		return
	}
	write(w, 200, receipts)
}
func (a *server) pull(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	// ParseQuery explicitly: URL.Query silently discards malformed escapes.
	values, err := parseCursor(r)
	if err != nil {
		problem(w, store.ErrInvalid)
		return
	}
	owner, ok := a.owner(w, r, p)
	if !ok {
		return
	}
	page, e := a.s.Pull(r.Context(), owner, r.PathValue("id"), values.after, values.limit)
	if e != nil {
		problem(w, e)
		return
	}
	write(w, 200, page)
}
