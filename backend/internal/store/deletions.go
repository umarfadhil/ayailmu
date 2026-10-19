package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	// ErrAccountDeleted reports a request of an account whose deletion is recorded: its server data is
	// erased, and nothing is read or written for it again.
	ErrAccountDeleted = errors.New("store: the account was deleted")
	// ErrErasureFailed reports an erasure that failed before COMMIT. Its transaction rolled back, so
	// nothing was erased or recorded. It wraps the cause, whose class may be logged.
	ErrErasureFailed = errors.New("store: the account erasure failed and was rolled back")
)

// Deletion is an account's recorded deletion (migration 0002): when it was requested, what its erasure
// removed, and the identity-provider step.
type Deletion struct {
	DeletionID string
	AccountID  string
	// RequestedAt is the time of the erasure transaction, which erased the data and recorded the
	// deletion together.
	RequestedAt time.Time
	// The rows the erasure removed: profiles, device links (profile_sources), events and imports.
	Profiles    int
	DeviceLinks int
	Events      int64
	Imports     int
	// IdentityAttempts counts the attempts to delete the identity-provider account. IdentityDeletedAt
	// is set once an attempt is confirmed, and never cleared.
	IdentityAttempts  int
	IdentityDeletedAt *time.Time
}

const deletionColumns = `deletion_id::text, account_id::text, requested_at, erased_profiles, erased_device_links,
	erased_events, erased_imports, identity_attempts, identity_deleted_at`

func scanDeletion(row pgx.Row) (Deletion, error) {
	var d Deletion
	err := row.Scan(&d.DeletionID, &d.AccountID, &d.RequestedAt, &d.Profiles, &d.DeviceLinks, &d.Events, &d.Imports,
		&d.IdentityAttempts, &d.IdentityDeletedAt)
	return d, err
}

// accountLockKey names the per-account advisory lock. Import takes it first, and so does EraseAccount,
// so an erasure and an import never interleave. The name predates erasure.
func accountLockKey(schema, accountID string) string {
	return "ayailmu-import:" + schema + ":" + accountID
}

// EraseAccount erases the account's server data and records its deletion in one READ COMMITTED
// transaction, or returns the deletion already recorded without erasing anything again. The account
// row stays: its (issuer, subject) anchors the record, so the identity's tokens find a deleted account
// and never create a new one.
//
// The locks follow the one order every writer of the account agrees on:
//  1. the account's advisory lock, the one Import takes first. While an import holds it, the erasure
//     waits holding nothing of the account, so the import's next step (an insert that key-share locks
//     the account row, or a profile row lock) never waits for the erasure. Taking the account row
//     first would deadlock with such an import;
//  2. the account row (FOR UPDATE);
//  3. every profile row of the account, in profile_id order (FOR UPDATE). This waits for an ingest or
//     settings update holding one; those take no account-level lock, so they never wait for the
//     erasure. Once these are held, no writer can add a row of the account.
//
// Then it deletes the account's events, imports, device links and profiles (nothing cascades), records
// the counts, runs beforeCommit (the test seam documented on server.Options) and commits. A failure
// before COMMIT wraps ErrErasureFailed: nothing was erased or recorded. A failed COMMIT is returned as it
// is, because its outcome is unknown.
func (s *Store) EraseAccount(ctx context.Context, accountID string, beforeCommit func(ctx context.Context)) (Deletion, error) {
	failed := func(err error) (Deletion, error) {
		return Deletion{}, fmt.Errorf("%w: %w", ErrErasureFailed, err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return failed(err)
	}
	defer tx.Rollback(ctx) // a no-op after Commit; it also ends a transaction that found the deletion recorded
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", accountLockKey(s.schema, accountID)); err != nil {
		return failed(err)
	}
	// Under the lock, a concurrent deletion has either committed its record or not started: the data
	// is never erased twice.
	if d, found, err := readDeletion(ctx, tx, accountID); err != nil || found {
		if err != nil {
			return failed(err)
		}
		return d, nil
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM accounts WHERE account_id = $1::uuid FOR UPDATE`, accountID); err != nil {
		return failed(err)
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM profiles WHERE account_id = $1::uuid ORDER BY profile_id FOR UPDATE`, accountID); err != nil {
		return failed(err)
	}
	// Each statement reads after the locks above were granted, so it sees every row a writer that held
	// one of them committed.
	var events, imports, links, profiles int64
	for _, step := range []struct {
		sql     string
		deleted *int64
	}{
		{`DELETE FROM events WHERE profile_id IN (SELECT profile_id FROM profiles WHERE account_id = $1::uuid)`, &events},
		{`DELETE FROM imports WHERE account_id = $1::uuid`, &imports},
		{`DELETE FROM profile_sources WHERE account_id = $1::uuid`, &links},
		{`DELETE FROM profiles WHERE account_id = $1::uuid`, &profiles},
	} {
		tag, err := tx.Exec(ctx, step.sql, accountID)
		if err != nil {
			return failed(err)
		}
		*step.deleted = tag.RowsAffected()
	}
	d, err := scanDeletion(tx.QueryRow(ctx, `INSERT INTO account_deletions (account_id, erased_profiles, erased_device_links,
		erased_events, erased_imports) VALUES ($1::uuid, $2, $3, $4, $5) RETURNING `+deletionColumns,
		accountID, profiles, links, events, imports))
	if err != nil {
		return failed(err)
	}
	if beforeCommit != nil {
		beforeCommit(ctx)
	}
	if err := tx.Commit(ctx); err != nil {
		return Deletion{}, fmt.Errorf("store: commit account erasure: %w", err)
	}
	return d, nil
}

// RecordIdentityAttempt records one attempt to delete the account's identity-provider account and
// returns the deletion as it stands after it. A confirmed attempt sets identity_deleted_at unless it is
// set already; a failed one only counts and stamps identity_last_failure_at, and never clears a
// confirmation. Concurrent attempts serialize on the row, so the record is deleted as soon as any
// attempt confirmed it.
func (s *Store) RecordIdentityAttempt(ctx context.Context, accountID string, confirmed bool) (Deletion, error) {
	d, err := scanDeletion(s.pool.QueryRow(ctx, `UPDATE account_deletions SET identity_attempts = identity_attempts + 1,
		identity_deleted_at = CASE WHEN $2::boolean THEN coalesce(identity_deleted_at, now()) ELSE identity_deleted_at END,
		identity_last_failure_at = CASE WHEN $2::boolean THEN identity_last_failure_at ELSE now() END
		WHERE account_id = $1::uuid RETURNING `+deletionColumns, accountID, confirmed))
	if err != nil {
		return Deletion{}, fmt.Errorf("store: record identity deletion: %w", err)
	}
	return d, nil
}

// AccountDeletion returns the account's recorded deletion; found is false when there is none.
func (s *Store) AccountDeletion(ctx context.Context, accountID string) (Deletion, bool, error) {
	return readDeletion(ctx, s.pool, accountID)
}

func readDeletion(ctx context.Context, q querier, accountID string) (Deletion, bool, error) {
	d, err := scanDeletion(q.QueryRow(ctx, `SELECT `+deletionColumns+` FROM account_deletions WHERE account_id = $1::uuid`, accountID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Deletion{}, false, nil
	}
	if err != nil {
		return Deletion{}, false, fmt.Errorf("store: read account deletion: %w", err)
	}
	return d, true, nil
}

func accountDeleted(ctx context.Context, q querier, accountID string) (bool, error) {
	var deleted bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM account_deletions WHERE account_id = $1::uuid)`, accountID).Scan(&deleted); err != nil {
		return false, fmt.Errorf("store: read account deletion: %w", err)
	}
	return deleted, nil
}

// missingProfile answers a lookup that found no profile of the account: ErrAccountDeleted when the
// account's deletion is recorded, because its erasure removed the profiles, and ErrNotFound otherwise.
// Callers run it in the lookup's own transaction: in a snapshot it sees what the lookup saw, and after a
// row-lock wait it sees the erasure that ended the wait.
func missingProfile(ctx context.Context, q querier, accountID string) error {
	deleted, err := accountDeleted(ctx, q, accountID)
	switch {
	case err != nil:
		return err
	case deleted:
		return ErrAccountDeleted
	default:
		return ErrNotFound
	}
}
