package store

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
	"regexp"
)

var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type ProfileInput struct {
	ClientLearnerID string `json:"client_learner_id"`
	Kind            string `json:"kind"`
	Lang            string `json:"lang"`
	CreatedBy       string `json:"created_by,omitempty"`
	Synthetic       bool   `json:"synthetic"`
}
type Profile struct {
	Synthetic       bool   `json:"-"`
	ID              string `json:"id"`
	ClientLearnerID string `json:"client_learner_id"`
	Kind            string `json:"kind"`
	Audience        string `json:"audience"`
	Lang            string `json:"lang"`
	CreatedBy       string `json:"created_by,omitempty"`
}

const profileColumns = `id::text,client_learner_id,kind,audience,lang,COALESCE(created_by::text,''),synthetic`

func scanProfile(row pgx.Row) (Profile, error) {
	var p Profile
	err := row.Scan(&p.ID, &p.ClientLearnerID, &p.Kind, &p.Audience, &p.Lang, &p.CreatedBy, &p.Synthetic)
	return p, err
}
func (s *Store) CreateProfile(ctx context.Context, owner string, in ProfileInput) (Profile, error) {
	if !native.ID(in.ClientLearnerID) || (in.Kind != "ADULT" && in.Kind != "ANAK") || (in.Lang != "id" && in.Lang != "en") || in.Kind == "ADULT" && in.CreatedBy != "" || in.Kind == "ANAK" && !uuid.MatchString(in.CreatedBy) {
		return Profile{}, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Profile{}, err
	}
	defer tx.Rollback(ctx)
	// A transaction-scoped account advisory lock serializes same-client-ID creation/replay
	// without granting UPDATE on immutable account identity just to acquire a row lock.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, owner); err != nil {
		return Profile{}, err
	}
	var account string
	var accountSynthetic bool
	if err = tx.QueryRow(ctx, `SELECT id::text,synthetic FROM accounts WHERE id=$1`, owner).Scan(&account, &accountSynthetic); err != nil {
		return Profile{}, ErrAccount
	}
	if accountSynthetic != in.Synthetic {
		return Profile{}, ErrConflict
	}
	existing, err := scanProfile(tx.QueryRow(ctx, `SELECT `+profileColumns+` FROM learners WHERE owner_id=$1 AND client_learner_id=$2`, owner, in.ClientLearnerID))
	if err == nil {
		if existing.Kind != in.Kind || existing.Lang != in.Lang || existing.CreatedBy != in.CreatedBy {
			return Profile{}, ErrConflict
		}
		return existing, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, err
	}
	audience := "adults"
	if in.Kind == "ANAK" {
		audience = "kids"
		var ok bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM learners WHERE id=$1 AND owner_id=$2 AND kind='ADULT')`, in.CreatedBy, owner).Scan(&ok)
		if err != nil {
			return Profile{}, err
		}
		if !ok {
			return Profile{}, ErrInvalid
		}
	}
	p, err := scanProfile(tx.QueryRow(ctx, `INSERT INTO learners(owner_id,client_learner_id,kind,audience,lang,created_by,synthetic) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid,$7) RETURNING `+profileColumns, owner, in.ClientLearnerID, in.Kind, audience, in.Lang, in.CreatedBy, in.Synthetic))
	if err != nil {
		return Profile{}, err
	}
	return p, tx.Commit(ctx)
}
func (s *Store) Profiles(ctx context.Context, owner string) ([]Profile, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+profileColumns+` FROM learners WHERE owner_id=$1 ORDER BY created_at,id LIMIT 1000`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func owned(ctx context.Context, tx pgx.Tx, owner, id string) (Profile, int64, error) {
	if !uuid.MatchString(id) {
		return Profile{}, 0, ErrNotFound
	}
	var p Profile
	var seq int64
	err := tx.QueryRow(ctx, `SELECT `+profileColumns+`,next_sequence FROM learners WHERE id=$1 AND owner_id=$2 FOR UPDATE`, id, owner).Scan(&p.ID, &p.ClientLearnerID, &p.Kind, &p.Audience, &p.Lang, &p.CreatedBy, &p.Synthetic, &seq)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return p, seq, err
}
func (s *Store) Consent(ctx context.Context, owner, id string, grant bool, version string) error {
	if version == "" {
		return ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	profile, _, err := owned(ctx, tx, owner, id)
	if err != nil {
		return err
	}
	purpose := "normal-owner-learning-sync"
	if profile.Synthetic {
		purpose = "synthetic-offline-sync"
		if version != "synthetic-sync-v1" {
			return ErrInvalid
		}
	} else if !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,79}$`).MatchString(version) || version == "synthetic-sync-v1" {
		return ErrInvalid
	}
	_, err = tx.Exec(ctx, `INSERT INTO sync_consents(learner_id,owner_id,purpose,version,granted) VALUES($1,$2,$3,$4,$5)`, id, owner, purpose, version, grant)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func consented(ctx context.Context, tx pgx.Tx, profile Profile, requiredConsentVersion ...string) error {
	var granted bool
	var purpose, version string
	err := tx.QueryRow(ctx, `SELECT purpose,version,granted FROM sync_consents WHERE learner_id=$1 ORDER BY id DESC LIMIT 1`, profile.ID).Scan(&purpose, &version, &granted)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !granted {
		return ErrConsent
	}
	if err != nil {
		return err
	}
	if profile.Synthetic {
		if purpose != "synthetic-offline-sync" || version != "synthetic-sync-v1" {
			return ErrConsentVersion
		}
		return nil
	}
	if len(requiredConsentVersion) != 1 || requiredConsentVersion[0] == "" {
		return ErrConsentVersion
	}
	if purpose != "normal-owner-learning-sync" || version != requiredConsentVersion[0] {
		return ErrConsentVersion
	}
	return nil
}
