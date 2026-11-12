package store

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrDatabaseHostNotAllowed reports, in the deploy modes, a host pgx would dial (the primary or any fallback, after
	// pgx applied the PG* environment and service files) that is not exactly one of the allowed database hosts.
	ErrDatabaseHostNotAllowed = errors.New("store: every database host pgx would dial must be one of the allowed database hosts")
	// ErrSchemaNotCurrent reports a schema whose recorded migrations are not exactly this binary's embedded ones: absent,
	// older, newer or with one missing. The deploy modes refuse to start on it and report not ready; only the migration
	// job (cmd/ayailmu-migrate) changes it.
	ErrSchemaNotCurrent = errors.New("store: the database schema is not at this binary's migration version; run the migration job")
)

// ParseConfigAllowing parses dsn with pgx as ParseConfig does, but refuses it unless every host pgx would dial, the
// primary and each fallback, is exactly one of allowed: neither loopback nor a Unix socket directory is implied. It
// opens nothing.
func ParseConfigAllowing(dsn, schema string, allowed []string) (*pgxpool.Config, error) {
	return parseConfig(dsn, schema, func(host string) bool { return slices.Contains(allowed, host) }, ErrDatabaseHostNotAllowed)
}

// OpenAllowing guards dsn with ParseConfigAllowing and only then creates the pool and checks it with one ping. It
// neither creates nor migrates the schema: the deploy modes verify it (VerifySchema).
func OpenAllowing(ctx context.Context, dsn, schema string, allowed []string) (*Store, error) {
	cfg, err := ParseConfigAllowing(dsn, schema, allowed)
	if err != nil {
		return nil, err
	}
	return openPool(ctx, cfg, schema)
}

// VerifySchema checks, with reads only, that the schema's recorded migrations are exactly this binary's embedded ones,
// and otherwise reports ErrSchemaNotCurrent. It reads in one read-only transaction and never creates or changes
// anything, so a runtime role without any DDL right can run it, and readiness can repeat it.
func (s *Store) VerifySchema(ctx context.Context) error {
	want, err := embeddedVersions()
	if err != nil {
		return err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("store: begin the schema check: %w", err)
	}
	defer tx.Rollback(ctx) // the check only reads
	var recorded bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = 'schema_migrations' AND c.relkind IN ('r', 'p'))`, s.schema).Scan(&recorded); err != nil {
		return fmt.Errorf("store: check the schema: %w", err)
	}
	if !recorded {
		return ErrSchemaNotCurrent
	}
	rows, err := tx.Query(ctx, "SELECT version FROM "+pgx.Identifier{s.schema, "schema_migrations"}.Sanitize()+" ORDER BY version")
	if err != nil {
		return fmt.Errorf("store: read the recorded migrations: %w", err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		return fmt.Errorf("store: read the recorded migrations: %w", err)
	}
	if !slices.Equal(got, want) {
		return ErrSchemaNotCurrent
	}
	return nil
}

// SchemaVersion is this binary's schema version: its newest embedded migration, which a current schema records last.
func SchemaVersion() (int, error) {
	versions, err := embeddedVersions()
	if err != nil {
		return 0, err
	}
	if len(versions) == 0 {
		return 0, errors.New("store: no migration is embedded")
	}
	return versions[len(versions)-1], nil
}

// embeddedVersions lists this binary's migration versions in ascending order.
func embeddedVersions() ([]int, error) {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return nil, fmt.Errorf("store: read migrations: %w", err)
	}
	versions := make([]int, 0, len(entries))
	for _, e := range entries {
		v, ok := migrationVersion(e.Name())
		if !ok {
			return nil, fmt.Errorf("store: migration file %q has no numeric version prefix", e.Name())
		}
		versions = append(versions, v)
	}
	slices.Sort(versions)
	return versions, nil
}
