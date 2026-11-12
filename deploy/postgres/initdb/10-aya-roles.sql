-- Local synthetic Compose stack: roles, databases and grants. The official entrypoint runs this once, when the cluster
-- is first initialised, as the bootstrap superuser over the container's own socket. Each role's password is read from
-- its private file in this container's own secrets volume by psql itself (\set with a backquoted cat): no password is
-- in an argument, the environment or this file, and this session never logs a failed statement's text.
--
--   aya_owner       owns the app schema; only the migration job logs in as it.
--   aya_runtime     the API: SELECT, INSERT, UPDATE and DELETE on the app tables; no DDL anywhere, no TEMP.
--   aya_backup      pg_dump: SELECT on every table of both databases, nothing else. BYPASSRLS only so that pg_dump
--                   reads whole tables should a vendor table enable row-level security; it grants no write.
--   aya_auth_owner  GoTrue: owns Auth's database and its auth schema, where it migrates and runs; nothing else.
-- None is a superuser or may create databases or roles, replicate or inherit.
\set ON_ERROR_STOP on
SET log_min_error_statement = panic;

\set owner_password `cat /run/aya/db/aya_owner.password`
\set runtime_password `cat /run/aya/db/aya_runtime.password`
\set backup_password `cat /run/aya/db/aya_backup.password`
\set auth_password `cat /run/aya/db/aya_auth_owner.password`

CREATE ROLE aya_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5
    PASSWORD :'owner_password';
CREATE ROLE aya_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20
    PASSWORD :'runtime_password';
CREATE ROLE aya_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT CONNECTION LIMIT 4
    PASSWORD :'backup_password';
CREATE ROLE aya_auth_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20
    PASSWORD :'auth_password';

\unset owner_password
\unset runtime_password
\unset backup_password
\unset auth_password

-- The app database. Its owner stays the bootstrap superuser: the migration role may connect and create its own schema
-- (store.Migrate creates it if absent), the runtime and backup roles may only connect. PUBLIC gets nothing, TEMP included.
CREATE DATABASE aya_app;
REVOKE ALL ON DATABASE aya_app FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE aya_app TO aya_owner;
GRANT CONNECT ON DATABASE aya_app TO aya_runtime, aya_backup;

-- Auth's database, owned by its dedicated role. The vendor expects its auth schema to exist before it migrates, and its
-- unqualified table names resolve there through the role's search path in this database only.
CREATE DATABASE aya_auth OWNER aya_auth_owner;
REVOKE ALL ON DATABASE aya_auth FROM PUBLIC;
GRANT CONNECT ON DATABASE aya_auth TO aya_backup;
ALTER ROLE aya_auth_owner IN DATABASE aya_auth SET search_path = auth;

\connect aya_app
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA ayailmu AUTHORIZATION aya_owner;
GRANT USAGE ON SCHEMA ayailmu TO aya_runtime, aya_backup;
-- Every table and sequence the migration role creates in the schema: DML for the runtime, reads for the backup.
ALTER DEFAULT PRIVILEGES FOR ROLE aya_owner IN SCHEMA ayailmu GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aya_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE aya_owner IN SCHEMA ayailmu GRANT USAGE, SELECT ON SEQUENCES TO aya_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE aya_owner IN SCHEMA ayailmu GRANT SELECT ON TABLES TO aya_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE aya_owner IN SCHEMA ayailmu GRANT SELECT ON SEQUENCES TO aya_backup;

\connect aya_auth
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA auth AUTHORIZATION aya_auth_owner;
GRANT USAGE ON SCHEMA auth TO aya_backup;
-- Every table and sequence GoTrue creates as its owner in the auth schema: reads for the backup.
ALTER DEFAULT PRIVILEGES FOR ROLE aya_auth_owner IN SCHEMA auth GRANT SELECT ON TABLES TO aya_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE aya_auth_owner IN SCHEMA auth GRANT SELECT ON SEQUENCES TO aya_backup;
