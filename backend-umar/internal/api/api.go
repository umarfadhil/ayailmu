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

type DeploymentDataMode string

const (
	DeploymentNormalOnly   DeploymentDataMode = "NORMAL_ONLY"
	DeploymentSyntheticLab DeploymentDataMode = "SYNTHETIC_LAB"
)

func ParseDeploymentDataMode(value string) (DeploymentDataMode, error) {
	switch DeploymentDataMode(value) {
	case DeploymentNormalOnly, DeploymentSyntheticLab:
		return DeploymentDataMode(value), nil
	default:
		return "", errors.New("UMAR_DATA_MODE must be NORMAL_ONLY or SYNTHETIC_LAB")
	}
}

type ReleasePolicy struct {
	Enabled            bool
	DeclarationVersion string
	ConsentVersion     string
}

func ParseReleasePolicy(enabled, declarationVersion, consentVersion string) (ReleasePolicy, error) {
	p := ReleasePolicy{Enabled: enabled == "true", DeclarationVersion: declarationVersion, ConsentVersion: consentVersion}
	if !p.Enabled {
		return ReleasePolicy{}, nil
	}
	valid := func(v string) bool {
		if len(v) < 3 || len(v) > 80 {
			return false
		}
		for i, r := range v {
			if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || i > 0 && r == '-' {
				continue
			}
			return false
		}
		return true
	}
	if !valid(declarationVersion) || !valid(consentVersion) || declarationVersion == "synthetic-sync-v1" || consentVersion == "synthetic-sync-v1" {
		return ReleasePolicy{}, errors.New("normal release requires exact approved declaration and sync policy versions")
	}
	return p, nil
}

type server struct {
	s      *store.Store
	v      *auth.Verifier
	r      *catalog.Registry
	normal ReleasePolicy
	mode   DeploymentDataMode
}
type action func(http.ResponseWriter, *http.Request, auth.Principal)

func New(s *store.Store, v *auth.Verifier, r *catalog.Registry) http.Handler {
	return NewWithRelease(s, v, r, ReleasePolicy{}, DeploymentSyntheticLab)
}
func NewWithRelease(s *store.Store, v *auth.Verifier, r *catalog.Registry, normal ReleasePolicy, modes ...DeploymentDataMode) http.Handler {
	mode := DeploymentNormalOnly
	if len(modes) == 1 {
		mode = modes[0]
	}
	if normal.Enabled && mode != DeploymentNormalOnly {
		panic("normal readiness requires NORMAL_ONLY deployment mode")
	}
	a := &server{s: s, v: v, r: r, normal: normal, mode: mode}
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
		if identity, ok := a.ownerInfo(w, r, p); ok && a.modeAllowed(w, identity.Synthetic) {
			write(w, 200, map[string]string{"account_id": identity.ID})
		}
	}))
	m.HandleFunc("POST /v1/learners", a.secure(a.createProfile))
	m.HandleFunc("GET /v1/learners", a.secure(a.profiles))
	m.HandleFunc("POST /v1/learners/{id}/consent", a.secure(a.consent))
	m.HandleFunc("POST /v1/learners/{id}/events", a.secure(a.append))
	m.HandleFunc("GET /v1/learners/{id}/events", a.secure(a.pull))
	m.HandleFunc("GET /v1/packs", a.secure(func(w http.ResponseWriter, r *http.Request, p auth.Principal) { write(w, 200, a.catalogResponse()) }))
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
func (a *server) catalogResponse() *catalog.Registry {
	if a.mode == DeploymentNormalOnly && !a.normal.Enabled {
		return &catalog.Registry{SourceCommit: a.r.SourceCommit, Packs: []catalog.Pack{}}
	}
	if !a.normal.Enabled {
		return a.r
	}
	out := &catalog.Registry{SourceCommit: a.r.SourceCommit, Packs: []catalog.Pack{}}
	for _, pack := range a.r.Packs {
		if pack.Synthetic {
			continue
		}
		items := map[string]catalog.Item{}
		for id, item := range pack.Items {
			if item.ReviewStatus == "approved" {
				items[id] = item
			}
		}
		if len(items) > 0 {
			pack.Items = items
			out.Packs = append(out.Packs, pack)
		}
	}
	return out
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
	case errors.Is(e, store.ErrConsentVersion):
		failure(w, 403, "sync_consent_update_required")
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
func (a *server) ownerInfo(w http.ResponseWriter, r *http.Request, p auth.Principal) (store.AccountIdentity, bool) {
	identity, err := a.s.AccountInfo(r.Context(), p.Issuer, p.Subject)
	if err != nil {
		problem(w, err)
		return store.AccountIdentity{}, false
	}
	return identity, true
}
func (a *server) modeAllowed(w http.ResponseWriter, synthetic bool) bool {
	if a.mode == DeploymentNormalOnly && synthetic || a.mode == DeploymentSyntheticLab && !synthetic {
		failure(w, 403, "deployment_data_mode_mismatch")
		return false
	}
	if !synthetic && !a.normal.Enabled {
		failure(w, 403, "normal_release_required")
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
	if a.mode == DeploymentNormalOnly && in.Synthetic || a.mode == DeploymentSyntheticLab && !in.Synthetic {
		problem(w, store.ErrInvalid)
		return
	}
	if !in.AdultConfirmed || in.Synthetic && in.DeclarationVersion != "adult-owner-v1" ||
		!in.Synthetic && (!a.normal.Enabled || in.DeclarationVersion != a.normal.DeclarationVersion) {
		problem(w, store.ErrInvalid)
		return
	}
	id, err := a.s.ActivateWithDeclaration(r.Context(), p.Issuer, p.Subject, in.DeclarationVersion, in.Synthetic)
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
	if !in.Synthetic && !a.normal.Enabled {
		problem(w, store.ErrInvalid)
		return
	}
	identity, ok := a.ownerInfo(w, r, p)
	if !ok || identity.Synthetic != in.Synthetic {
		if ok {
			problem(w, store.ErrInvalid)
		}
		return
	}
	if !a.modeAllowed(w, identity.Synthetic) {
		return
	}
	profile, err := a.s.CreateProfile(r.Context(), identity.ID, in)
	if err != nil {
		problem(w, err)
		return
	}
	write(w, 200, profile)
}
func (a *server) profiles(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	identity, ok := a.ownerInfo(w, r, p)
	if !ok || !a.modeAllowed(w, identity.Synthetic) {
		return
	}
	profiles, err := a.s.Profiles(r.Context(), identity.ID)
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
	if in.Granted == nil || in.Synthetic && in.Version != "synthetic-sync-v1" ||
		!in.Synthetic && (!a.normal.Enabled || in.Version != a.normal.ConsentVersion) {
		problem(w, store.ErrInvalid)
		return
	}
	identity, ok := a.ownerInfo(w, r, p)
	if !ok || identity.Synthetic != in.Synthetic {
		if ok {
			problem(w, store.ErrInvalid)
		}
		return
	}
	if !a.modeAllowed(w, identity.Synthetic) {
		return
	}
	if err := a.s.Consent(r.Context(), identity.ID, r.PathValue("id"), *in.Granted, in.Version); err != nil {
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
	if in.SchemaVersion != 1 || !in.Synthetic && !a.normal.Enabled {
		problem(w, store.ErrInvalid)
		return
	}
	identity, ok := a.ownerInfo(w, r, p)
	if !ok || identity.Synthetic != in.Synthetic {
		if ok {
			problem(w, store.ErrInvalid)
		}
		return
	}
	if !a.modeAllowed(w, identity.Synthetic) {
		return
	}
	receipts, err := a.s.Append(r.Context(), identity.ID, r.PathValue("id"), in.Events, a.normal.ConsentVersion)
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
	identity, ok := a.ownerInfo(w, r, p)
	if !ok || !a.modeAllowed(w, identity.Synthetic) {
		return
	}
	page, e := a.s.Pull(r.Context(), identity.ID, r.PathValue("id"), values.after, values.limit, a.normal.ConsentVersion)
	if e != nil {
		problem(w, e)
		return
	}
	write(w, 200, page)
}
