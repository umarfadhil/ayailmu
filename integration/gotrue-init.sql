-- Vendor migration 20240612123726 grants read access to a postgres role.
-- This standalone server has a differently named bootstrap owner; no login is needed.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        CREATE ROLE postgres NOLOGIN;
    END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION umar_gotrue;
ALTER ROLE umar_gotrue SET search_path = auth;
