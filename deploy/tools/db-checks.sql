-- Checks of the local Compose stack's roles, grants, ownership, client authentication and connections, which
-- aya_stack.py verify runs on stdin of psql (-X -q -A -t -F '|') as the bootstrap superuser over the database
-- container's own socket. It prints name|value lines only: role attributes, privilege booleans and counts, SQLSTATEs,
-- migration versions and a digest of their times. Never a row of data, an email, a password or a hash.
--
-- The behavioural probes act as one service role (SET LOCAL ROLE) inside a transaction that always rolls back, so a probe
-- that wrongly succeeded still leaves nothing behind. Each prints probe.<role>.<action>|<SQLSTATE>: 42501 is
-- insufficient_privilege, 00000 success.
\set ON_ERROR_STOP on

-- Roles: attributes, password kind and memberships.
SELECT 'role.' || rolname,
       json_build_object('login', rolcanlogin, 'superuser', rolsuper, 'createdb', rolcreatedb, 'createrole', rolcreaterole,
                         'replication', rolreplication, 'bypassrls', rolbypassrls, 'inherit', rolinherit,
                         'connlimit', rolconnlimit,
                         'scram_password', coalesce(left(rolpassword, 14) = 'SCRAM-SHA-256$', false))::text
  FROM pg_authid
 WHERE rolname IN ('postgres', 'aya_owner', 'aya_runtime', 'aya_backup', 'aya_auth_owner')
 ORDER BY rolname;
SELECT 'roles.superusers', count(*) FROM pg_authid WHERE rolsuper;
SELECT 'roles.aya_memberships', count(*)
  FROM pg_auth_members m JOIN pg_authid r ON r.oid = m.member OR r.oid = m.roleid
 WHERE r.rolname LIKE 'aya\_%';

-- Databases: owner, PUBLIC's rights, and each service role's.
SELECT 'database.' || datname,
       json_build_object('owner', pg_get_userbyid(datdba),
                         'public_connect', has_database_privilege('public', datname, 'CONNECT'),
                         'public_temp', has_database_privilege('public', datname, 'TEMP'))::text
  FROM pg_database
 WHERE datname IN ('aya_app', 'aya_auth')
 ORDER BY datname;
SELECT 'grant.database.' || d.datname || '.' || r.rolname,
       json_build_object('connect', has_database_privilege(r.rolname, d.datname, 'CONNECT'),
                         'create', has_database_privilege(r.rolname, d.datname, 'CREATE'),
                         'temp', has_database_privilege(r.rolname, d.datname, 'TEMP'))::text
  FROM pg_database d
 CROSS JOIN (VALUES ('aya_owner'), ('aya_runtime'), ('aya_backup'), ('aya_auth_owner')) AS r(rolname)
 WHERE d.datname IN ('aya_app', 'aya_auth')
 ORDER BY 1;

-- Client authentication as the server loaded it, and server settings.
SELECT 'hba.rules',
       json_agg(json_build_object('type', type, 'database', database, 'user', user_name, 'address', address,
                                  'method', auth_method) ORDER BY line_number)::text
  FROM pg_hba_file_rules;
SELECT 'hba.errors', count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;
SELECT 'setting.' || name, setting
  FROM pg_settings
 WHERE name IN ('password_encryption', 'ssl', 'listen_addresses', 'log_statement', 'log_min_error_statement')
 ORDER BY name;

-- Who is connected, by role and database (this session excluded).
SELECT 'connections.' || coalesce(usename, '-') || '@' || coalesce(datname, '-'), count(*)
  FROM pg_stat_activity
 WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
 GROUP BY usename, datname
 ORDER BY 1;

\connect aya_app

SELECT 'app.schema', json_build_object('owner', pg_get_userbyid(nspowner))::text FROM pg_namespace WHERE nspname = 'ayailmu';
SELECT 'app.tables', json_build_object('count', count(*), 'owners', coalesce(json_agg(DISTINCT tableowner), '[]'::json))::text
  FROM pg_tables
 WHERE schemaname = 'ayailmu';
SELECT 'app.migrations', coalesce(json_agg(version ORDER BY version), '[]'::json)::text FROM ayailmu.schema_migrations;
SELECT 'app.migrations_digest', md5(coalesce(string_agg(version::text || '@' || applied_at::text, ',' ORDER BY version), ''))
  FROM ayailmu.schema_migrations;
SELECT 'app.accounts', count(*) FROM ayailmu.accounts;
SELECT 'app.account_deletions', count(*) FROM ayailmu.account_deletions;
SELECT 'app.profiles', count(*) FROM ayailmu.profiles;
SELECT 'grant.schema.ayailmu.' || r.rolname,
       json_build_object('usage', has_schema_privilege(r.rolname, 'ayailmu', 'USAGE'),
                         'create', has_schema_privilege(r.rolname, 'ayailmu', 'CREATE'))::text
  FROM (VALUES ('aya_owner'), ('aya_runtime'), ('aya_backup'), ('aya_auth_owner')) AS r(rolname)
 ORDER BY 1;
SELECT 'grant.schema.app_public.' || r.rolname,
       json_build_object('usage', has_schema_privilege(r.rolname, 'public', 'USAGE'),
                         'create', has_schema_privilege(r.rolname, 'public', 'CREATE'))::text
  FROM (VALUES ('aya_owner'), ('aya_runtime'), ('aya_backup'), ('aya_auth_owner')) AS r(rolname)
 ORDER BY 1;
SELECT 'grant.tables.ayailmu.' || r.rolname,
       json_build_object('tables', count(*),
                         'select', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'SELECT')),
                         'insert', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'INSERT')),
                         'update', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'UPDATE')),
                         'delete', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'DELETE')),
                         'truncate', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'TRUNCATE')),
                         'references', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'REFERENCES')),
                         'trigger', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'TRIGGER')))::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 CROSS JOIN (VALUES ('aya_owner'), ('aya_runtime'), ('aya_backup'), ('aya_auth_owner')) AS r(rolname)
 WHERE n.nspname = 'ayailmu' AND c.relkind IN ('r', 'p')
 GROUP BY r.rolname
 ORDER BY 1;

\set ON_ERROR_STOP off

-- The API's runtime role: DML on the app tables, and no DDL, TRUNCATE or TEMP anywhere.
BEGIN;
SET LOCAL ROLE aya_runtime;
CREATE TABLE ayailmu.aya_probe_ddl (x integer);
\echo probe.runtime.create_table_in_app_schema|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
CREATE TABLE public.aya_probe_ddl (x integer);
\echo probe.runtime.create_table_in_public|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
CREATE SCHEMA aya_probe;
\echo probe.runtime.create_schema|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
CREATE TEMP TABLE aya_probe_tmp (x integer);
\echo probe.runtime.create_temp_table|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
ALTER TABLE ayailmu.accounts ADD COLUMN aya_probe integer;
\echo probe.runtime.alter_table|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
CREATE INDEX aya_probe_idx ON ayailmu.events (seq);
\echo probe.runtime.create_index|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
DROP TABLE ayailmu.events;
\echo probe.runtime.drop_table|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
TRUNCATE ayailmu.events;
\echo probe.runtime.truncate|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
SELECT 1 FROM ayailmu.accounts LIMIT 0;
\echo probe.runtime.select|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
INSERT INTO ayailmu.accounts (auth_mode, issuer, subject) VALUES ('local-supabase', 'aya-probe', 'aya-probe');
\echo probe.runtime.insert_rolled_back|:SQLSTATE
ROLLBACK;

-- The backup role: reads, and nothing else.
BEGIN;
SET LOCAL ROLE aya_backup;
SELECT 1 FROM ayailmu.events LIMIT 0;
\echo probe.backup.select_app|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_backup;
INSERT INTO ayailmu.accounts (auth_mode, issuer, subject) VALUES ('local-supabase', 'aya-probe', 'aya-probe');
\echo probe.backup.insert_app|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_backup;
UPDATE ayailmu.profiles SET revision = revision WHERE false;
\echo probe.backup.update_app|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_backup;
DELETE FROM ayailmu.events WHERE false;
\echo probe.backup.delete_app|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_backup;
TRUNCATE ayailmu.events;
\echo probe.backup.truncate_app|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_backup;
CREATE TABLE ayailmu.aya_probe_ddl (x integer);
\echo probe.backup.create_table_app|:SQLSTATE
ROLLBACK;

-- Auth's owner has no business in the app schema.
BEGIN;
SET LOCAL ROLE aya_auth_owner;
SELECT 1 FROM ayailmu.accounts LIMIT 0;
\echo probe.auth_owner.select_app|:SQLSTATE
ROLLBACK;

\set ON_ERROR_STOP on
\connect aya_auth

SELECT 'auth.schema', json_build_object('owner', pg_get_userbyid(nspowner))::text FROM pg_namespace WHERE nspname = 'auth';
SELECT 'auth.tables', json_build_object('count', count(*), 'owners', coalesce(json_agg(DISTINCT tableowner), '[]'::json))::text
  FROM pg_tables
 WHERE schemaname = 'auth';
SELECT 'auth.rls_tables', count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'auth' AND c.relrowsecurity;
SELECT 'auth.users', count(*) FROM auth.users;
SELECT 'auth.owner_search_path', coalesce(array_to_string(s.setconfig, ','), '')
  FROM pg_db_role_setting s
  JOIN pg_database d ON d.oid = s.setdatabase
  JOIN pg_authid r ON r.oid = s.setrole
 WHERE d.datname = 'aya_auth' AND r.rolname = 'aya_auth_owner';
SELECT 'grant.tables.auth.' || r.rolname,
       json_build_object('tables', count(*),
                         'select', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'SELECT')),
                         'insert', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'INSERT')),
                         'update', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'UPDATE')),
                         'delete', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'DELETE')),
                         'truncate', count(*) FILTER (WHERE has_table_privilege(r.rolname, c.oid, 'TRUNCATE')))::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 CROSS JOIN (VALUES ('aya_owner'), ('aya_runtime'), ('aya_backup'), ('aya_auth_owner')) AS r(rolname)
 WHERE n.nspname = 'auth' AND c.relkind IN ('r', 'p')
 GROUP BY r.rolname
 ORDER BY 1;

\set ON_ERROR_STOP off

BEGIN;
SET LOCAL ROLE aya_backup;
SELECT 1 FROM auth.users LIMIT 0;
\echo probe.backup.select_auth|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_backup;
DELETE FROM auth.users WHERE false;
\echo probe.backup.delete_auth|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_backup;
CREATE TABLE auth.aya_probe_ddl (x integer);
\echo probe.backup.create_table_auth|:SQLSTATE
ROLLBACK;
BEGIN;
SET LOCAL ROLE aya_runtime;
SELECT 1 FROM auth.users LIMIT 0;
\echo probe.runtime.select_auth|:SQLSTATE
ROLLBACK;

\echo checks.complete|yes
