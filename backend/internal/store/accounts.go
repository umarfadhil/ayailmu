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

// Account is an authenticated caller's account.
type Account struct {
	ID string
	// Deleted reports that the account's deletion is recorded: its server data is erased.
	Deleted bool
}

// EnsureAccount returns the account keyed by (issuer, subject), creating it on first use with authMode:
// the configured mode whose verifier verified the identity ("emulator" or "local-supabase", which the
// accounts check allows). An account stores the verified issuer and subject only: no email, name, phone
// or photo. It is found by that identity alone, and its recorded mode never changes. A deleted account
// keeps its row, so a token of its identity finds it, reported Deleted, and never creates a new account.
func (s *Store) EnsureAccount(ctx context.Context, authMode, issuer, subject string) (Account, error) {
	const find = `SELECT a.account_id::text, EXISTS (SELECT 1 FROM account_deletions d WHERE d.account_id = a.account_id)
		FROM accounts a WHERE a.issuer = $1 AND a.subject = $2`
	var acct Account
	err := s.pool.QueryRow(ctx, find, issuer, subject).Scan(&acct.ID, &acct.Deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		err = s.pool.QueryRow(ctx, `INSERT INTO accounts (auth_mode, issuer, subject) VALUES ($1, $2, $3)
			ON CONFLICT (issuer, subject) DO NOTHING RETURNING account_id::text`, authMode, issuer, subject).Scan(&acct.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			// A concurrent first request created the account between the two statements.
			err = s.pool.QueryRow(ctx, find, issuer, subject).Scan(&acct.ID, &acct.Deleted)
		}
	}
	if err != nil {
		return Account{}, fmt.Errorf("store: ensure account: %w", err)
	}
	return acct, nil
}

// AccountProfiles lists the account's profiles in creation order. An empty list of an account whose
// deletion is recorded is ErrAccountDeleted: the erasure committed after the request was authenticated.
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
	if len(list) == 0 {
		if deleted, err := accountDeleted(ctx, s.pool, accountID); err != nil || deleted {
			if err == nil {
				err = ErrAccountDeleted
			}
			return nil, err
		}
	}
	return list, nil
}
