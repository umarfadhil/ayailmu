package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ProfileSummary is one profile of an account as /v1/me lists it.
type ProfileSummary struct {
	ProfileID string
	Revision  int64
	HighSeq   int64
}

// EnsureAccount returns the ID of the account keyed by (issuer, subject), creating it on first use. An
// account stores the verified issuer and subject only: no email, name, phone or photo.
func (s *Store) EnsureAccount(ctx context.Context, issuer, subject string) (string, error) {
	const find = `SELECT account_id::text FROM accounts WHERE issuer = $1 AND subject = $2`
	var id string
	err := s.pool.QueryRow(ctx, find, issuer, subject).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		err = s.pool.QueryRow(ctx, `INSERT INTO accounts (auth_mode, issuer, subject) VALUES ('emulator', $1, $2)
			ON CONFLICT (issuer, subject) DO NOTHING RETURNING account_id::text`, issuer, subject).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			// A concurrent first request created the account between the two statements.
			err = s.pool.QueryRow(ctx, find, issuer, subject).Scan(&id)
		}
	}
	if err != nil {
		return "", fmt.Errorf("store: ensure account: %w", err)
	}
	return id, nil
}

// AccountProfiles lists the account's profiles in creation order.
func (s *Store) AccountProfiles(ctx context.Context, accountID string) ([]ProfileSummary, error) {
	rows, err := s.pool.Query(ctx, `SELECT profile_id::text, revision, high_seq FROM profiles
		WHERE account_id = $1::uuid ORDER BY created_at, profile_id`, accountID)
	if err != nil {
		return nil, fmt.Errorf("store: list profiles: %w", err)
	}
	defer rows.Close()
	var list []ProfileSummary
	for rows.Next() {
		var p ProfileSummary
		if err := rows.Scan(&p.ProfileID, &p.Revision, &p.HighSeq); err != nil {
			return nil, fmt.Errorf("store: list profiles: %w", err)
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list profiles: %w", err)
	}
	return list, nil
}
