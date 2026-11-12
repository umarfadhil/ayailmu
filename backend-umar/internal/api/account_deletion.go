package api

import (
	"errors"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/accounterase"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"net/http"
)

func deletionRequest(w http.ResponseWriter, r *http.Request, target any) bool {
	if r.URL.RawQuery != "" || r.URL.ForceQuery || r.Header.Get("Cookie") != "" {
		failure(w, 400, "invalid_request")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	return decode(w, r, target)
}
func (a *server) deleteAccount(w http.ResponseWriter, r *http.Request, p auth.Principal) {
	var in accounterase.Request
	if !deletionRequest(w, r, &in) || !fresh(w, p) {
		return
	}
	if a.mode != DeploymentNormalOnly || a.erasure == nil {
		failure(w, 503, "account_erasure_unavailable")
		return
	}
	receipt, err := a.erasure.Begin(r.Context(), p, in)
	if errors.Is(err, accounterase.ErrFreshAuth) {
		failure(w, 403, "fresh_authentication_required")
		return
	}
	if err != nil {
		problem(w, err)
		return
	}
	code := http.StatusAccepted
	if receipt.Status == "completed" {
		code = http.StatusOK
	}
	write(w, code, receipt)
}
func (a *server) accountDeletionStatus(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RequestID     string `json:"request_id"`
		RecoveryToken string `json:"recovery_token"`
	}
	if !deletionRequest(w, r, &in) {
		return
	}
	// This exact proof-only read is intentionally outside Auth. A deleted Auth user
	// cannot authenticate, and a readiness/config rollback must not lose the receipt.
	receipt, err := a.s.AccountDeletionStatus(r.Context(), in.RequestID, in.RecoveryToken)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			failure(w, 404, "not_found")
		} else {
			failure(w, 503, "service_unavailable")
		}
		return
	}
	write(w, 200, receipt)
}
