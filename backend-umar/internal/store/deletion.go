package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// DeletionReceipt describes completed server erasure, never device or provider identity deletion.
type DeletionReceipt struct {
	DeletionID  string    `json:"deletion_id"`
	Scope       string    `json:"scope"`
	LearnerID   string    `json:"learner_id"`
	RequestID   string    `json:"request_id"`
	CompletedAt time.Time `json:"completed_at"`
}

func (s *Store) DeleteLearner(ctx context.Context, owner, learner, request string) (DeletionReceipt, error) {
	if !uuid.MatchString(owner) || !uuid.MatchString(learner) || !uuid.MatchString(request) {
		return DeletionReceipt{}, ErrInvalid
	}
	var result DeletionReceipt
	err := s.pool.QueryRow(ctx, `SELECT deletion_id::text,scope,target_id::text,request_id::text,completed_at FROM public.erase_learner($1,$2,$3)`, owner, learner, request).Scan(&result.DeletionID, &result.Scope, &result.LearnerID, &result.RequestID, &result.CompletedAt)
	var dbErr *pgconn.PgError
	if errors.As(err, &dbErr) {
		switch dbErr.Code {
		case "P0400":
			err = ErrInvalid
		case "P0404":
			err = ErrNotFound
		case "P0409":
			err = ErrConflict
		case "P0424":
			err = ErrDependents
		}
	}
	return result, err
}
