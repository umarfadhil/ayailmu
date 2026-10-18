package store

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
)

var (
	ErrNotFound = errors.New("not_found")
	ErrInvalid  = errors.New("invalid_request")
	ErrConflict = errors.New("idempotency_conflict")
	ErrConsent  = errors.New("sync_consent_required")
	ErrAccount  = errors.New("adult_owner_required")
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	pool     *pgxpool.Pool
	registry *catalog.Registry
}

func Open(ctx context.Context, url string, r *catalog.Registry) (*Store, error) {
	if url == "" || r == nil {
		return nil, errors.New("explicit isolated database URL and catalog required")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid database configuration")
	}
	cfg.MaxConns = 8
	cfg.MaxConnLifetime = time.Hour
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, errors.New("database initialization failed")
	}
	return &Store{p, r}, nil
}
func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }
func hash(b []byte) string                      { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(81856585)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		b, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		sum := hash(b)
		var old string
		err = tx.QueryRow(ctx, `SELECT sha256 FROM schema_migrations WHERE version=$1`, entry.Name()).Scan(&old)
		if err == nil {
			if old != sum {
				return errors.New("migration checksum changed")
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err = tx.Exec(ctx, string(b)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)`, entry.Name(), sum); err != nil {
			return err
		}
	}
	for _, p := range s.registry.Packs {
		b, err := json.Marshal(p)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO pack_versions(track,content_version,source_commit,pack_sha256,rules_sha256,rules_version,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, p.Track, p.ContentVersion, s.registry.SourceCommit, p.SHA256, p.RulesSHA256, p.RulesVersion, b)
		if err != nil {
			return err
		}
		var ps, rs, commit string
		if err = tx.QueryRow(ctx, `SELECT pack_sha256,rules_sha256,source_commit FROM pack_versions WHERE track=$1 AND content_version=$2`, p.Track, p.ContentVersion).Scan(&ps, &rs, &commit); err != nil {
			return err
		}
		if ps != p.SHA256 || rs != p.RulesSHA256 || commit != s.registry.SourceCommit {
			return fmt.Errorf("registry version collision: %s", p.Track)
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) Activate(ctx context.Context, issuer, subject string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `INSERT INTO accounts(issuer,subject,declaration_version,synthetic) VALUES($1,$2,'adult-owner-v1',true) ON CONFLICT(issuer,subject) DO UPDATE SET issuer=EXCLUDED.issuer RETURNING id::text`, issuer, subject).Scan(&id)
	return id, err
}
func (s *Store) Account(ctx context.Context, issuer, subject string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id::text FROM accounts WHERE issuer=$1 AND subject=$2`, issuer, subject).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrAccount
	}
	return id, err
}
