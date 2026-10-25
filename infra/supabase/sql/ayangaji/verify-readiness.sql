-- Read-only readiness/isolation catalog check. Prints name|t/f lines only: never a row of data.
-- Variables (psql -v): schema, migration_role, runtime_role, expected_user.
\set ON_ERROR_STOP on
SELECT 'must.connected_as_expected_role', current_user = :'expected_user';
SELECT 'must.tls_in_use', COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false);
SELECT 'info.server_major', (current_setting('server_version_num')::int / 10000)::text;
SELECT 'must.migration_role_exists_plain', COALESCE((SELECT NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
  FROM pg_roles WHERE rolname = :'migration_role'), false);
SELECT 'must.runtime_role_exists_plain', COALESCE((SELECT NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
  FROM pg_roles WHERE rolname = :'runtime_role'), false);
SELECT 'must.runtime_not_member_of_migration', NOT pg_has_role(:'runtime_role', :'migration_role', 'MEMBER');
SELECT 'must.runtime_cannot_create_in_schema', NOT has_schema_privilege(:'runtime_role', :'schema', 'CREATE');
SELECT 'must.runtime_cannot_create_in_database', NOT has_database_privilege(:'runtime_role', current_database(), 'CREATE');
SELECT 'must.schema_migrations_present', to_regclass(format('%I.schema_migrations', :'schema')) IS NOT NULL;
SELECT 'must.app_relations_owned_by_migration_role', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = :'schema' AND c.relkind IN ('r','p','S','v','m') AND pg_get_userbyid(c.relowner) <> :'migration_role');
-- The adult API legitimately updates and deletes (account erasure, ledger replay) but never truncates, alters, triggers,
-- references or owns. has_table_privilege with a comma list answers "ANY of them", so every required right is tested alone
-- against the exact matrix the service's source uses (store.runtimeRights, proven by the application's own test).
SELECT 'must.runtime_has_dml_but_no_ddl', NOT EXISTS (
  SELECT 1 FROM (VALUES ('accounts','SELECT'),('accounts','INSERT'),('accounts','UPDATE'),
                        ('account_deletions','SELECT'),('account_deletions','INSERT'),('account_deletions','UPDATE'),
                        ('profiles','SELECT'),('profiles','INSERT'),('profiles','UPDATE'),('profiles','DELETE'),
                        ('profile_sources','SELECT'),('profile_sources','INSERT'),('profile_sources','DELETE'),
                        ('events','SELECT'),('events','INSERT'),('events','DELETE'),
                        ('imports','SELECT'),('imports','INSERT'),('imports','DELETE'),
                        ('schema_migrations','SELECT')) need(rel, priv)
   WHERE NOT COALESCE(has_table_privilege(:'runtime_role', to_regclass(format('%I.%I', :'schema', need.rel)), need.priv), false))
  AND NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = :'schema' AND c.relkind IN ('r','p')
     AND (pg_has_role(:'runtime_role', c.relowner, 'USAGE')
          OR has_table_privilege(:'runtime_role', c.oid, 'TRUNCATE,TRIGGER,REFERENCES')
          OR has_any_column_privilege(:'runtime_role', c.oid, 'REFERENCES')
          OR has_table_privilege(:'runtime_role', c.oid, 'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION')));
SELECT 'must.runtime_cannot_write_migration_history', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = :'schema' AND c.relname = 'schema_migrations' AND c.relkind IN ('r','p')
     AND (has_table_privilege(:'runtime_role', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
          OR has_any_column_privilege(:'runtime_role', c.oid, 'INSERT,UPDATE')));
SELECT 'must.runtime_not_member_of_any_role', NOT EXISTS (
  SELECT 1 FROM pg_auth_members m WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = :'runtime_role'));
SELECT 'must.runtime_cannot_create_in_public', NOT has_schema_privilege(:'runtime_role', 'public', 'CREATE');
SELECT 'must.schema_exists_and_owned_by_migration_role', COALESCE((SELECT pg_get_userbyid(nspowner) = :'migration_role'
  FROM pg_namespace WHERE nspname = :'schema'), false);
SELECT 'must.hosted_auth_schema_untouched_by_app_roles', NOT EXISTS (
  SELECT 1 FROM pg_namespace n WHERE n.nspname = 'auth'
     AND (has_schema_privilege(:'runtime_role', n.oid, 'USAGE,CREATE') OR has_schema_privilege(:'migration_role', n.oid, 'CREATE')));
-- Data API roles (present only on a Supabase server) and PUBLIC hold nothing on application relations.
SELECT 'must.api_roles_have_no_relation_privileges', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') UNION ALL SELECT 'public') g
   WHERE n.nspname = :'schema' AND c.relkind IN ('r','p','S','v','m')
     AND (CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(g.rolname, c.oid, 'USAGE,SELECT,UPDATE')
               ELSE has_table_privilege(g.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END));
SELECT 'must.api_roles_cannot_execute_functions', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') UNION ALL SELECT 'public') g
   WHERE n.nspname = :'schema' AND p.prokind = 'f' AND has_function_privilege(g.rolname, p.oid, 'EXECUTE'));
-- Default ACLs of the MIGRATION role decide what its future tables expose. Other creators' defaults (postgres,
-- supabase_admin) do not apply to objects this role creates; they are reported, not failed.
SELECT 'must.default_acls_do_not_expose', NOT EXISTS (
  SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace,
         LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = :'schema' AND pg_get_userbyid(d.defaclrole) = :'migration_role'
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role')));
SELECT 'info.other_creators_default_acls_exposing', count(*) FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace,
         LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = :'schema' AND pg_get_userbyid(d.defaclrole) <> :'migration_role'
     AND pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role');
SELECT 'info.relations_with_rls', (SELECT count(*) FILTER (WHERE c.relrowsecurity) || '/' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :'schema' AND c.relkind IN ('r','p'));
