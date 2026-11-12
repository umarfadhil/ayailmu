package api

import (
	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"net/http"
)

func (a *server) deleteLearner(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	var in struct {
		RequestID string `json:"request_id"`
		Confirmed bool   `json:"confirmed"`
		Synthetic bool   `json:"synthetic"`
	}
	if !decode(w, r, &in) || !fresh(w, p) {
		return
	}
	if !in.Confirmed {
		problem(w, store.ErrInvalid)
		return
	}
	identity, ok := a.ownerInfo(w, r, p)
	if !ok {
		return
	}
	// Readiness rollback stops new learning, not an existing owner's right to erase.
	if identity.Synthetic != in.Synthetic || a.mode == DeploymentNormalOnly && identity.Synthetic || a.mode == DeploymentSyntheticLab && !identity.Synthetic {
		failure(w, 403, "deployment_data_mode_mismatch")
		return
	}
	receipt, err := a.s.DeleteLearner(r.Context(), identity.ID, r.PathValue("id"), in.RequestID)
	if err != nil {
		problem(w, err)
		return
	}
	write(w, 200, receipt)
}
