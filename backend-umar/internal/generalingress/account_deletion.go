package generalingress

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
)

const accountDeletionPath = "/v1/account/deletion"
const accountDeletionStatusPath = accountDeletionPath + "/status"

type deletionStatusInput struct {
	RequestID     string `json:"request_id"`
	RecoveryToken string `json:"recovery_token"`
}

func statusInput(body []byte) (deletionStatusInput, error) {
	var in deletionStatusInput
	if len(body) > 1024 || native.Decode(body, &in) != nil || !uuid.MatchString(in.RequestID) || in.RequestID == "00000000-0000-0000-0000-000000000000" || !store.ValidRecoveryProof(in.RecoveryToken) {
		return in, ErrDenied
	}
	return in, nil
}

type accountStatusReader interface {
	AccountDeletionStatus(context.Context, []byte) (store.AccountDeletionStatus, error)
}

func (e *Engine) accountStatus(ctx context.Context, r Request) Response {
	if !e.allowed("account-erasure-status-ip:"+r.Peer, e.p.AuthIPMinute, time.Minute) {
		return result(429, "retry_later")
	}
	backend, ok := e.backend.(accountStatusReader)
	if !ok {
		return result(503, "unavailable")
	}
	receipt, err := backend.AccountDeletionStatus(ctx, r.Body)
	if err != nil {
		var failure *wireFailure
		if errors.As(err, &failure) {
			return result(failure.status, failure.code)
		}
		return result(503, "unavailable")
	}
	return Response{Status: 200, Code: "ok", Data: receipt}
}
func accountReceipt(raw []byte, request string) (store.AccountDeletionStatus, error) {
	var in struct {
		DeletionID        string  `json:"deletion_id"`
		Scope             string  `json:"scope"`
		RequestID         string  `json:"request_id"`
		Status            string  `json:"status"`
		AppDataErasedAt   string  `json:"app_data_erased_at"`
		IdentityDeletedAt *string `json:"identity_deleted_at"`
	}
	if len(raw) > 4096 || native.Decode(raw, &in) != nil || in.Scope != "account" || in.RequestID != request || !uuid.MatchString(in.DeletionID) || in.DeletionID == "00000000-0000-0000-0000-000000000000" {
		return store.AccountDeletionStatus{}, ErrUnavailable
	}
	erased, err := time.Parse(time.RFC3339Nano, in.AppDataErasedAt)
	if err != nil || erased.IsZero() {
		return store.AccountDeletionStatus{}, ErrUnavailable
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	receipt := store.AccountDeletionStatus{DeletionID: in.DeletionID, Scope: in.Scope, RequestID: in.RequestID, Status: in.Status, AppDataErasedAt: erased}
	switch in.Status {
	case "identity_deletion_pending":
		if in.IdentityDeletedAt != nil || len(fields) != 5 {
			return store.AccountDeletionStatus{}, ErrUnavailable
		}
	case "completed":
		if in.IdentityDeletedAt == nil || len(fields) != 6 {
			return store.AccountDeletionStatus{}, ErrUnavailable
		}
		at, err := time.Parse(time.RFC3339Nano, *in.IdentityDeletedAt)
		if err != nil || at.Before(erased) {
			return store.AccountDeletionStatus{}, ErrUnavailable
		}
		receipt.IdentityDeletedAt = &at
	default:
		return store.AccountDeletionStatus{}, ErrUnavailable
	}
	return receipt, nil
}

// AccountDeletionStatus never authenticates or sends the caller's bearer credential.
// This exact fixed route only reads a minimal proof-bound receipt, without provider I/O.
func (b *HTTPBackend) AccountDeletionStatus(ctx context.Context, body []byte) (store.AccountDeletionStatus, error) {
	in, err := statusInput(body)
	if err != nil {
		return store.AccountDeletionStatus{}, err
	}
	if b == nil || b.p == nil || !b.p.ready() {
		return store.AccountDeletionStatus{}, ErrUnavailable
	}
	raw, err := b.p.request(ctx, "POST", accountDeletionStatusPath, in, "")
	if err != nil {
		return store.AccountDeletionStatus{}, err
	}
	return accountReceipt(raw, in.RequestID)
}
