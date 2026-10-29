package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Prepare preserves local automatic migrations. A restricted deployment instead verifies the
// exact schema/catalog and runtime permissions, without executing any DDL or modifying history.
func (s *Store) Prepare(ctx context.Context, migrate bool) error {
	if migrate {
		if err := s.Migrate(ctx); err != nil {
			return err
		}
		return s.VerifySchema(ctx)
	}
	if err := s.VerifySchema(ctx); err != nil {
		return err
	}
	return s.verifyRuntimeRole(ctx)
}

// VerifySchema rejects missing, changed and newer migrations instead of silently serving an
// incompatible database. It checks registered pack provenance inside one read-only snapshot.
func (s *Store) VerifySchema(ctx context.Context) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT version,sha256 FROM public.schema_migrations`)
	if err != nil {
		return err
	}
	applied := map[string]string{}
	for rows.Next() {
		var version, sum string
		if err = rows.Scan(&version, &sum); err != nil {
			rows.Close()
			return err
		}
		applied[version] = sum
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	if len(applied) != len(entries) {
		return errors.New("database schema version mismatch")
	}
	for _, entry := range entries {
		data, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		if applied[entry.Name()] != hash(data) {
			return errors.New("database migration checksum mismatch")
		}
	}
	for _, pack := range s.registry.Packs {
		metadata, err := json.Marshal(pack)
		if err != nil {
			return err
		}
		var matches bool
		err = tx.QueryRow(ctx, `SELECT source_commit=$3 AND pack_sha256=$4 AND rules_sha256=$5
			AND rules_version=$6 AND metadata=$7::jsonb FROM public.pack_versions
			WHERE track=$1 AND content_version=$2`, pack.Track, pack.ContentVersion, s.registry.SourceCommit,
			pack.SHA256, pack.RulesSHA256, pack.RulesVersion, string(metadata)).Scan(&matches)
		if err != nil {
			return err
		}
		if !matches {
			return errors.New("database catalog provenance mismatch")
		}
	}
	return tx.Commit(ctx)
}

// Grants alone cannot remove rights inherited from PUBLIC or other roles. Fail closed on the
// dangerous effective privileges relevant to this schema; this is not a row-level security claim.
func (s *Store) verifyRuntimeRole(ctx context.Context) error {
	var unsafe bool
	err := s.pool.QueryRow(ctx, `SELECT
		rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
		OR has_schema_privilege('public','CREATE')
		OR has_database_privilege(current_database(),'CREATE')
		OR EXISTS (
			SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
			WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (
				pg_has_role(c.relowner,'USAGE') OR has_table_privilege(c.oid,'DELETE,TRUNCATE,TRIGGER')
				OR (c.relname NOT IN ('accounts','learners','sync_consents','answer_events')
					AND has_any_column_privilege(c.oid,'INSERT'))
				OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0
					AND NOT a.attisdropped AND has_column_privilege(c.oid,a.attnum,'UPDATE')
					AND NOT (c.relname='learners' AND a.attname='next_sequence'))
			)
		) FROM pg_roles WHERE rolname=current_user`).Scan(&unsafe)
	if err != nil {
		return err
	}
	if unsafe {
		return errors.New("runtime database role has unsafe effective privileges")
	}
	var ready bool
	err = s.pool.QueryRow(ctx, `SELECT
		has_schema_privilege('public','USAGE')
		AND has_table_privilege('public.schema_migrations','SELECT')
		AND has_table_privilege('public.pack_versions','SELECT')
		AND has_table_privilege('public.accounts','SELECT') AND has_table_privilege('public.accounts','INSERT')
		AND has_table_privilege('public.learners','SELECT') AND has_table_privilege('public.learners','INSERT')
		AND has_column_privilege('public.learners','next_sequence','UPDATE')
		AND has_table_privilege('public.sync_consents','SELECT') AND has_table_privilege('public.sync_consents','INSERT')
		AND has_table_privilege('public.answer_events','SELECT') AND has_table_privilege('public.answer_events','INSERT')
		AND has_sequence_privilege('public.sync_consents_id_seq','USAGE')`).Scan(&ready)
	if err != nil {
		return err
	}
	if !ready {
		return errors.New("runtime database role is missing required privileges")
	}
	return nil
}
