package store

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"strings"
	"time"
)

var ErrAccountDeleted = errors.New("account deletion requested")

// AccountDeletionStatus contains no credentials, provider subject or learner details.
type AccountDeletionStatus struct {
	DeletionID        string     `json:"deletion_id"`
	Scope             string     `json:"scope"`
	RequestID         string     `json:"request_id"`
	Status            string     `json:"status"`
	AppDataErasedAt   time.Time  `json:"app_data_erased_at"`
	IdentityDeletedAt *time.Time `json:"identity_deleted_at,omitempty"`
}
type AccountDeletionJob struct {
	DeletionID, LeaseID, Issuer, Subject string
	Attempts                             int64
}

func (AccountDeletionJob) String() string     { return "store.AccountDeletionJob{redacted}" }
func (j AccountDeletionJob) GoString() string { return j.String() }

const accountDeletionColumns = `deletion_id::text,request_id::text,app_data_erased_at,identity_deleted_at`

func scanAccountDeletion(row pgx.Row) (AccountDeletionStatus, error) {
	var out AccountDeletionStatus
	err := row.Scan(&out.DeletionID, &out.RequestID, &out.AppDataErasedAt, &out.IdentityDeletedAt)
	out.Scope = "account"
	out.Status = "identity_deletion_pending"
	if out.IdentityDeletedAt != nil {
		out.Status = "completed"
	}
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return out, accountDeletionError(err)
}

// RecoveryProof is a client-generated cryptographically random 256-bit lowercase hex value.
// This validates encoding, not entropy; native clients must use their system CSPRNG.
func ValidRecoveryProof(token string) bool {
	if len(token) != 64 || token == strings.Repeat("0", 64) {
		return false
	}
	for _, c := range token {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func validDeletionUUID(s string) bool {
	return uuid.MatchString(s) && s != "00000000-0000-0000-0000-000000000000"
}
func accountDeletionError(err error) error {
	var db *pgconn.PgError
	if errors.As(err, &db) {
		switch db.Code {
		case "P0400":
			return ErrInvalid
		case "P0404":
			return ErrNotFound
		case "P0409", "23505":
			return ErrConflict
		case "P0410":
			return ErrAccountDeleted
		}
	}
	return err
}
func (s *Store) BeginAccountDeletion(ctx context.Context, owner, issuer, subject, request, recovery string) (AccountDeletionStatus, error) {
	if !validDeletionUUID(owner) || !validDeletionUUID(request) || issuer == "" || subject == "" || !ValidRecoveryProof(recovery) {
		return AccountDeletionStatus{}, ErrInvalid
	}
	return scanAccountDeletion(s.pool.QueryRow(ctx, `SELECT `+accountDeletionColumns+` FROM public.begin_account_erasure($1,$2,$3,$4,$5)`, owner, issuer, subject, request, hash([]byte(recovery))))
}
func (s *Store) AccountDeletionStatus(ctx context.Context, request, recovery string) (AccountDeletionStatus, error) {
	if !validDeletionUUID(request) || !ValidRecoveryProof(recovery) {
		return AccountDeletionStatus{}, ErrNotFound
	}
	return scanAccountDeletion(s.pool.QueryRow(ctx, `SELECT `+accountDeletionColumns+` FROM public.account_erasure_status($1,$2)`, request, hash([]byte(recovery))))
}
func (s *Store) ClaimAccountDeletion(ctx context.Context, issuer string) (*AccountDeletionJob, error) {
	if issuer == "" {
		return nil, ErrInvalid
	}
	var out AccountDeletionJob
	err := s.pool.QueryRow(ctx, `SELECT deletion_id::text,lease_id::text,issuer,subject,attempts FROM public.claim_account_erasure($1)`, issuer).Scan(&out.DeletionID, &out.LeaseID, &out.Issuer, &out.Subject, &out.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, accountDeletionError(err)
	}
	return &out, nil
}
func (s *Store) FinishAccountDeletion(ctx context.Context, deletion, lease string, confirmed bool) error {
	if !validDeletionUUID(deletion) || !validDeletionUUID(lease) {
		return ErrInvalid
	}
	var matched bool
	err := s.pool.QueryRow(ctx, `SELECT public.finish_account_erasure($1,$2,$3)`, deletion, lease, confirmed).Scan(&matched)
	if err != nil {
		return accountDeletionError(err)
	}
	if !matched {
		return ErrConflict
	}
	return nil
}
