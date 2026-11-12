// Package store owns the PostgreSQL pool and schema of the local backend.
//
// A pool is opened only after the configuration pgx actually parsed has been checked: the primary
// host and every fallback, after pgx applied PG* environment variables and service files, must be a
// literal loopback IP or a Unix socket directory, or in the deploy modes exactly one of the deployment's
// database hosts (deploy.go). This is independent of the string check in package config, which never
// sees what pgx derives from the environment.
package store

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrDatabaseNotLocal = errors.New("store: every database host pgx would dial must be a literal loopback IP or a Unix socket directory")
	// ErrInvalidDatabaseURL replaces pgx's parse error, whose text quotes the connection string.
	ErrInvalidDatabaseURL = errors.New("store: the database URL cannot be parsed")
	ErrInvalidSchema      = errors.New("store: schema name is not allowed")
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store is an open, guarded pool whose connections use the configured schema as search_path.
type Store struct {
	pool   *pgxpool.Pool
	schema string
}

// ParseConfig parses dsn with pgx and refuses it unless every host pgx would dial is a literal loopback
// IP or a Unix socket directory. It opens nothing. The schema becomes the connections' search_path, and
// READ COMMITTED their default transaction isolation.
func ParseConfig(dsn, schema string) (*pgxpool.Config, error) {
	return parseConfig(dsn, schema, localHost, ErrDatabaseNotLocal)
}

// parseConfig parses dsn with pgx and refuses it with refusal unless allowed accepts every host pgx would
// dial: the primary and each fallback, after pgx applied the PG* environment and service files.
func parseConfig(dsn, schema string, allowed func(host string) bool, refusal error) (*pgxpool.Config, error) {
	if !validSchema(schema) {
		return nil, ErrInvalidSchema
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, ErrInvalidDatabaseURL
	}
	cc := cfg.ConnConfig
	if !allowed(cc.Host) {
		return nil, refusal
	}
	for _, fb := range cc.Fallbacks {
		if !allowed(fb.Host) {
			return nil, refusal
		}
	}
	cc.RuntimeParams["search_path"] = schema
	// A transaction that sets no isolation of its own runs READ COMMITTED, whatever the database URL, role, database or
	// server default: as a startup parameter this outranks all of them. The writers lock, then read what the lock's
	// holder committed, which only READ COMMITTED sees; under REPEATABLE READ or SERIALIZABLE a writer that waited on a
	// lock would fail with a serialization error instead. Read-only snapshots and ledger replay set their own isolation.
	cc.RuntimeParams["default_transaction_isolation"] = "read committed"
	if cc.ConnectTimeout == 0 {
		cc.ConnectTimeout = 5 * time.Second
	}
	return cfg, nil
}

// Open guards dsn (ParseConfig) and only then creates the pool and checks it with one ping.
func Open(ctx context.Context, dsn, schema string) (*Store, error) {
	cfg, err := ParseConfig(dsn, schema)
	if err != nil {
		return nil, err
	}
	return openPool(ctx, cfg, schema)
}

// openPool creates the pool of a guarded configuration and checks it with one ping.
func openPool(ctx context.Context, cfg *pgxpool.Config, schema string) (*Store, error) {
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: create pool: %w", connectCause(err))
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: connect: %w", connectCause(err))
	}
	return &Store{pool: pool, schema: schema}, nil
}

// Migrate creates the schema if needed and applies every embedded migration not yet recorded, in one
// transaction serialized per schema. It is idempotent, so a reopened service reuses existing data.
func (s *Store) Migrate(ctx context.Context) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("store: read migrations: %w", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("store: begin migration: %w", err)
	}
	defer tx.Rollback(ctx) // a no-op after Commit
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", "ayailmu-migrate:"+s.schema); err != nil {
		return fmt.Errorf("store: lock schema: %w", err)
	}
	ident := pgx.Identifier{s.schema}.Sanitize()
	for _, stmt := range []string{
		"CREATE SCHEMA IF NOT EXISTS " + ident,
		"CREATE TABLE IF NOT EXISTS " + ident + ".schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("store: prepare schema: %w", err)
		}
	}
	for _, e := range entries {
		version, ok := migrationVersion(e.Name())
		if !ok {
			return fmt.Errorf("store: migration file %q has no numeric version prefix", e.Name())
		}
		var applied bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM "+ident+".schema_migrations WHERE version = $1)", version).Scan(&applied); err != nil {
			return fmt.Errorf("store: read applied migrations: %w", err)
		}
		if applied {
			continue
		}
		sql, err := migrations.ReadFile("migrations/" + e.Name())
		if err != nil {
			return fmt.Errorf("store: read migration %s: %w", e.Name(), err)
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("store: apply migration %s: %w", e.Name(), err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO "+ident+".schema_migrations (version) VALUES ($1)", version); err != nil {
			return fmt.Errorf("store: record migration %s: %w", e.Name(), err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("store: commit migration: %w", err)
	}
	return nil
}

// Close closes the pool.
func (s *Store) Close() {
	s.pool.Close()
}

// localHost accepts a Unix socket directory (pgx dials a socket for any host starting with "/") or a
// literal loopback IP without zone or IPv4 mapping. Hostnames, "localhost" included, are refused.
func localHost(h string) bool {
	if strings.HasPrefix(h, "/") {
		return true
	}
	a, err := netip.ParseAddr(h)
	return err == nil && a.IsLoopback() && a.Zone() == "" && !a.Is4In6()
}

// validSchema matches package config's rule; the name is interpolated into DDL, so it is rechecked here.
func validSchema(s string) bool {
	if s == "" || len(s) > 63 || s == "public" || s == "information_schema" || strings.HasPrefix(s, "pg_") {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		letter := c >= 'a' && c <= 'z'
		tail := i > 0 && (c == '_' || (c >= '0' && c <= '9'))
		if !letter && !tail {
			return false
		}
	}
	return true
}

// migrationVersion reads the numeric prefix of "0001_name.sql".
func migrationVersion(name string) (int, bool) {
	prefix, _, ok := strings.Cut(name, "_")
	if !ok {
		return 0, false
	}
	v, err := strconv.Atoi(prefix)
	return v, err == nil && v > 0
}

// connectCause drops pgconn's connect-error preamble, which lists user and database names, and keeps the
// underlying cause.
func connectCause(err error) error {
	var ce *pgconn.ConnectError
	if errors.As(err, &ce) {
		if inner := ce.Unwrap(); inner != nil {
			return inner
		}
	}
	return err
}

// ErrorClass names a store error for logs without its text, which can quote connection parameters or
// row values: a PostgreSQL SQLSTATE, a timeout, a cancellation, or "other" (usually a refused or lost
// connection).
func ErrorClass(err error) string {
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return "none"
	case errors.As(err, &pgErr):
		return "sqlstate " + pgErr.Code
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	default:
		return "other"
	}
}
