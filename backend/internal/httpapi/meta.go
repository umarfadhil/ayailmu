package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/store"
)

type healthDoc struct {
	Status string `json:"status"`
	Mode   string `json:"mode"`
}

// health answers without authentication. It reports that the process serves, not that PostgreSQL or
// the emulator is reachable.
func (h *handler) health(w http.ResponseWriter, _ *http.Request, _ *call) {
	writeJSON(w, http.StatusOK, healthDoc{Status: "ok", Mode: h.mode})
}

// readyTimeout bounds one readiness check.
const readyTimeout = 3 * time.Second

type readyDoc struct {
	Status string `json:"status"`
}

// ready answers a deploy mode's readiness without authentication: ready while the database answers and
// its schema records exactly this binary's migrations (store.VerifySchema, which only reads), not_ready
// otherwise, without any detail. The reason is logged by class only.
func (h *handler) ready(w http.ResponseWriter, r *http.Request, _ *call) {
	ctx, cancel := context.WithTimeout(r.Context(), readyTimeout)
	defer cancel()
	if err := h.store.VerifySchema(ctx); err != nil {
		class := store.ErrorClass(err)
		if errors.Is(err, store.ErrSchemaNotCurrent) {
			class = "schema not current"
		}
		h.log.Warn("httpapi: not ready", "error_class", class)
		writeJSON(w, http.StatusServiceUnavailable, readyDoc{Status: "not_ready"})
		return
	}
	writeJSON(w, http.StatusOK, readyDoc{Status: "ready"})
}

type meProfile struct {
	ProfileID string `json:"profile_id"`
	Revision  int64  `json:"revision"`
	HighSeq   int64  `json:"high_seq"`
}

type meDoc struct {
	AccountID string      `json:"account_id"`
	Profiles  []meProfile `json:"profiles"`
}

// me lists the caller's account and profiles. Authentication has already created the account.
func (h *handler) me(w http.ResponseWriter, r *http.Request, c *call) {
	list, err := h.store.AccountProfiles(r.Context(), c.accountID)
	if errors.Is(err, store.ErrAccountDeleted) {
		writeAccountDeleted(w)
		return
	}
	if err != nil {
		h.internal(w, "list profiles", err)
		return
	}
	doc := meDoc{AccountID: c.accountID, Profiles: make([]meProfile, 0, len(list))}
	for _, p := range list {
		doc.Profiles = append(doc.Profiles, meProfile{ProfileID: p.ProfileID, Revision: p.Revision, HighSeq: p.HighSeq})
	}
	writeJSON(w, http.StatusOK, doc)
}

type curriculaDoc struct {
	Families []curriculum.Family `json:"families"`
	Packs    []curriculum.Pack   `json:"packs"`
}

// curricula returns the registry's metadata exactly: pack identity, lifecycle, synthetic flag and
// review counts. The registry holds no item content, answer keys or learner state, so none can leak.
func (h *handler) curricula(w http.ResponseWriter, _ *http.Request, _ *call) {
	writeJSON(w, http.StatusOK, curriculaDoc{Families: h.registry.Families(), Packs: h.registry.Packs()})
}
