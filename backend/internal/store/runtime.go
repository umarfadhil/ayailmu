package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// The runtime role's rights. The API of a deploy mode (and production) must run as a role that can do what the service does
// and nothing that reshapes the database or its history, whatever the credentials it was started with: unlike the migration
// job it needs no ownership, no DDL and no administrative attribute. VerifyRuntimePrivileges reads the connection's own
// effective rights from the catalogs (has_*_privilege answers for everything inherited, a different session role and
// PUBLIC included) and refuses to start the service on a role that is too powerful or too weak.
var (
	// ErrRuntimeRoleElevated reports a role that could reshape the database or act as another role: a superuser, one that creates
	// roles or databases, replicates or bypasses row security, one whose session role differs from its current role or that is
	// a member of any other role, an owner of the schema or of anything in it, one that can create objects in the schema,
	// public or the database, or that holds TRUNCATE, TRIGGER, REFERENCES or any grant option on an app table. The text names
	// no role, schema or table.
	ErrRuntimeRoleElevated = errors.New("store: the database role is more privileged than the service's runtime role may be: it must not be a superuser or an owner, administer roles or databases, replicate, bypass row security, belong to or act as another role, or be able to create, truncate, trigger or reference anything in the schema, public or the database")
	// ErrMigrationMetadataWritable reports a role with any right to write the migration history (schema_migrations): only the
	// migration job records migrations.
	ErrMigrationMetadataWritable = errors.New("store: the database role can write the migration history; only the migration job may")
	// ErrRuntimeRightsMissing reports a role that lacks USAGE on the schema or a right the service uses on one of its tables.
	ErrRuntimeRightsMissing = errors.New("store: the database role lacks a right the service needs on the schema and its tables")
)

// runtimeRights is exactly what the service's source does to each table, derived from every statement in this package and
// proven sufficient by TestExactRuntimeRightsSufficeForEveryStoreOperation. UPDATE on accounts is needed only because the
// erasure's SELECT ... FOR UPDATE row lock requires it; no code updates an accounts row. The adult service deletes (account
// erasure and ledger replay), unlike the guardian/child backend's, so DELETE is required where the source deletes.
var runtimeRights = []struct{ table, privilege string }{
	{"accounts", "SELECT"}, {"accounts", "INSERT"}, {"accounts", "UPDATE"},
	{"account_deletions", "SELECT"}, {"account_deletions", "INSERT"}, {"account_deletions", "UPDATE"},
	{"profiles", "SELECT"}, {"profiles", "INSERT"}, {"profiles", "UPDATE"}, {"profiles", "DELETE"},
	{"profile_sources", "SELECT"}, {"profile_sources", "INSERT"}, {"profile_sources", "DELETE"},
	{"events", "SELECT"}, {"events", "INSERT"}, {"events", "DELETE"},
	{"imports", "SELECT"}, {"imports", "INSERT"}, {"imports", "DELETE"},
	{"schema_migrations", "SELECT"},
}

// runtimePrivilegeCheck answers, for the connection's effective role and the schema $1, four questions: is it elevated, can it
// write the migration history, does it hold a forbidden right on an app table, and is a required right missing ($2 and $3 are
// the required table and privilege, pairwise). has_table_privilege accepts a list but then answers whether ANY item is held,
// which is what the forbidden lists want and why every required right is tested alone.
const runtimePrivilegeCheck = `
WITH ns AS (SELECT oid, nspowner FROM pg_catalog.pg_namespace WHERE nspname = $1)
SELECT
  (session_user <> current_user
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
              AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user))
   OR EXISTS (SELECT 1 FROM ns WHERE pg_catalog.pg_has_role(current_user, ns.nspowner, 'MEMBER')
              OR pg_catalog.has_schema_privilege(current_user, ns.oid, 'CREATE'))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN ns ON ns.oid = c.relnamespace
              WHERE pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER'))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN ns ON ns.oid = p.pronamespace
              WHERE pg_catalog.pg_has_role(current_user, p.proowner, 'MEMBER'))
   OR COALESCE(pg_catalog.has_schema_privilege(current_user, (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public'), 'CREATE'), false)
   OR pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE')) AS elevated,
  EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN ns ON ns.oid = c.relnamespace
          WHERE c.relname = 'schema_migrations' AND c.relkind IN ('r', 'p')
            AND (pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
                 OR pg_catalog.has_any_column_privilege(current_user, c.oid, 'INSERT, UPDATE'))) AS history_writable,
  EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN ns ON ns.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p')
            AND (pg_catalog.has_table_privilege(current_user, c.oid, 'TRUNCATE, TRIGGER')
                 OR pg_catalog.has_any_column_privilege(current_user, c.oid, 'REFERENCES')
                 OR pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT WITH GRANT OPTION, INSERT WITH GRANT OPTION, UPDATE WITH GRANT OPTION, DELETE WITH GRANT OPTION, REFERENCES WITH GRANT OPTION, TRIGGER WITH GRANT OPTION'))) AS table_forbidden,
  (NOT COALESCE((SELECT pg_catalog.has_schema_privilege(current_user, ns.oid, 'USAGE') FROM ns), false)
   OR EXISTS (SELECT 1 FROM unnest($2::text[], $3::text[]) AS need(rel, priv)
              LEFT JOIN (pg_catalog.pg_class c JOIN ns ON ns.oid = c.relnamespace AND c.relkind IN ('r', 'p')) ON c.relname = need.rel
              WHERE c.oid IS NULL OR NOT pg_catalog.has_table_privilege(current_user, c.oid, need.priv))) AS rights_missing`

// VerifyRuntimePrivileges checks, with reads only, that the connection's role is a plain runtime role: it reports
// ErrRuntimeRoleElevated for a role that is too powerful, ErrMigrationMetadataWritable for one that can write the migration
// history, and ErrRuntimeRightsMissing for one that lacks a right the service uses. The deploy modes call it at startup, after
// VerifySchema, and refuse to serve on any of them. It never changes anything and names nothing in its errors.
//
// It is an effective-rights check of the role the pool connects as, not a row-level security claim, and it cannot see what
// a hosted provider adds outside the PostgreSQL catalogs.
func (s *Store) VerifyRuntimePrivileges(ctx context.Context) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("store: begin the privilege check: %w", err)
	}
	defer tx.Rollback(ctx) // the check only reads
	tables := make([]string, len(runtimeRights))
	privileges := make([]string, len(runtimeRights))
	for i, r := range runtimeRights {
		tables[i], privileges[i] = r.table, r.privilege
	}
	var elevated, historyWritable, tableForbidden, rightsMissing bool
	if err := tx.QueryRow(ctx, runtimePrivilegeCheck, s.schema, tables, privileges).
		Scan(&elevated, &historyWritable, &tableForbidden, &rightsMissing); err != nil {
		return fmt.Errorf("store: check the role's privileges: %w", err)
	}
	switch {
	case elevated:
		return ErrRuntimeRoleElevated
	case historyWritable:
		return ErrMigrationMetadataWritable
	case tableForbidden:
		return ErrRuntimeRoleElevated
	case rightsMissing:
		return ErrRuntimeRightsMissing
	}
	return nil
}
