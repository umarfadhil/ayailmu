package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	// ErrNotFound reports a profile the account does not own: missing, another account's, or not a
	// UUID at all. Callers answer the three alike.
	ErrNotFound = errors.New("store: no such profile for this account")
	// ErrRevisionConflict reports a settings update whose base revision is no longer current.
	ErrRevisionConflict = errors.New("store: the profile revision changed")
)

// Settings are a profile's editable settings; nil means unset.
type Settings struct {
	InstructionLang *string
	SessionMinutes  *int
	ArabicScale     *float64
}

// Source is a device profile linked to a server profile.
type Source struct {
	App            string
	InstallID      string
	LocalProfileID string
}

// Profile is a stored adult profile. It has no label, name, birth year, email or phone.
type Profile struct {
	ProfileID      string
	Kind           string
	Revision       int64
	HighSeq        int64
	Settings       Settings
	ConsentVersion string
	ConsentAt      time.Time
	Sources        []Source
}

// querier is what a pool and a transaction have in common.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Profile reads one profile of the account and its linked sources from one snapshot. Like every profile
// lookup, it returns ErrAccountDeleted instead of ErrNotFound when the account's deletion is recorded.
func (s *Store) Profile(ctx context.Context, accountID, profileID string) (Profile, error) {
	if !validUUID(profileID) {
		return Profile{}, missingProfile(ctx, s.pool, accountID)
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Profile{}, fmt.Errorf("store: read profile: %w", err)
	}
	defer tx.Rollback(ctx) // read only: nothing to commit
	return loadProfile(ctx, tx, accountID, profileID)
}

// OwnsProfile reports whether the account owns the profile. When it does not and the account's
// deletion is recorded, it returns ErrAccountDeleted: a request authenticated just before an erasure
// committed gets account_deleted, never not_found.
func (s *Store) OwnsProfile(ctx context.Context, accountID, profileID string) (bool, error) {
	owned, err := ownsProfile(ctx, s.pool, accountID, profileID)
	if err != nil || owned {
		return owned, err
	}
	if err := missingProfile(ctx, s.pool, accountID); !errors.Is(err, ErrNotFound) {
		return false, err
	}
	return false, nil
}

// UpdateSettings replaces the profile's settings and increments its revision, provided the revision is
// still the given one. Otherwise it changes nothing and returns the current profile with
// ErrRevisionConflict. Event uploads and imports never call it, so they never change a revision. A
// profile an erasure removed while this waited for its row is ErrAccountDeleted, checked after that
// erasure committed.
func (s *Store) UpdateSettings(ctx context.Context, accountID, profileID string, revision int64, next Settings) (Profile, error) {
	if !validUUID(profileID) {
		return Profile{}, missingProfile(ctx, s.pool, accountID)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Profile{}, fmt.Errorf("store: update profile: %w", err)
	}
	defer tx.Rollback(ctx) // a no-op after Commit
	tag, err := tx.Exec(ctx, `UPDATE profiles SET instruction_lang = $4, session_minutes = $5, arabic_scale = $6, revision = revision + 1
		WHERE profile_id = $1::uuid AND account_id = $2::uuid AND revision = $3`,
		profileID, accountID, revision, next.InstructionLang, next.SessionMinutes, next.ArabicScale)
	if err != nil {
		return Profile{}, fmt.Errorf("store: update profile: %w", err)
	}
	// After a successful update this reads the new row, still locked by this transaction; otherwise it
	// reads the row as the concurrent writer committed it.
	p, err := loadProfile(ctx, tx, accountID, profileID)
	if err != nil {
		return Profile{}, err
	}
	if tag.RowsAffected() == 0 {
		return p, ErrRevisionConflict
	}
	if err := tx.Commit(ctx); err != nil {
		return Profile{}, fmt.Errorf("store: update profile: %w", err)
	}
	return p, nil
}

func loadProfile(ctx context.Context, q querier, accountID, profileID string) (Profile, error) {
	var p Profile
	err := q.QueryRow(ctx, `SELECT profile_id::text, kind, revision, high_seq, instruction_lang, session_minutes, arabic_scale,
		consent_version, consent_at FROM profiles WHERE profile_id = $1::uuid AND account_id = $2::uuid`, profileID, accountID).
		Scan(&p.ProfileID, &p.Kind, &p.Revision, &p.HighSeq, &p.Settings.InstructionLang, &p.Settings.SessionMinutes,
			&p.Settings.ArabicScale, &p.ConsentVersion, &p.ConsentAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, missingProfile(ctx, q, accountID)
	}
	if err != nil {
		return Profile{}, fmt.Errorf("store: read profile: %w", err)
	}
	if p.Sources, err = profileSources(ctx, q, accountID, profileID); err != nil {
		return Profile{}, err
	}
	return p, nil
}

// profileSources lists the device profiles linked to a profile, oldest link first.
func profileSources(ctx context.Context, q querier, accountID, profileID string) ([]Source, error) {
	rows, err := q.Query(ctx, `SELECT app, install_id, local_profile_id FROM profile_sources
		WHERE account_id = $1::uuid AND profile_id = $2::uuid ORDER BY linked_at, app, install_id, local_profile_id`, accountID, profileID)
	if err != nil {
		return nil, fmt.Errorf("store: read profile sources: %w", err)
	}
	defer rows.Close()
	var sources []Source
	for rows.Next() {
		var src Source
		if err := rows.Scan(&src.App, &src.InstallID, &src.LocalProfileID); err != nil {
			return nil, fmt.Errorf("store: read profile sources: %w", err)
		}
		sources = append(sources, src)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: read profile sources: %w", err)
	}
	return sources, nil
}

func ownsProfile(ctx context.Context, q querier, accountID, profileID string) (bool, error) {
	if !validUUID(profileID) {
		return false, nil
	}
	var owned bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM profiles WHERE profile_id = $1::uuid AND account_id = $2::uuid)`,
		profileID, accountID).Scan(&owned)
	if err != nil {
		return false, fmt.Errorf("store: resolve profile: %w", err)
	}
	return owned, nil
}

// validUUID accepts the hyphenated 8-4-4-4-12 hex form, so nothing else reaches a uuid cast.
func validUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') {
				return false
			}
		}
	}
	return true
}

// FormatTime renders a stored timestamp as every response does: UTC, RFC 3339, the stored
// microseconds without trailing zeros.
func FormatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}
