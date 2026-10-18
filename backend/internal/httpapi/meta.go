package httpapi

import (
	"net/http"

	"ayailmu.local/backend/internal/curriculum"
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
