-- Database roles for production deployments (spec §6, docs/MULTI-TENANCY.md).
--
--   seopilot_app    : NOSUPERUSER NOBYPASSRLS — what apps/web connects as (DATABASE_URL).
--   seopilot_worker : NOSUPERUSER NOBYPASSRLS — what apps/worker connects as; identical grants, uses
--                     app.bypass_rls='on' inside job handlers. Kept separate so its credentials can
--                     be rotated independently and its activity audited.
--
-- Roles are created idempotently and WITHOUT passwords; operators set them:
--   ALTER ROLE seopilot_app PASSWORD '...';
-- The migration user (DATABASE_MIGRATE_URL) owns the tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seopilot_app') THEN
    CREATE ROLE seopilot_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seopilot_worker') THEN
    CREATE ROLE seopilot_worker LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO seopilot_app, seopilot_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO seopilot_app, seopilot_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO seopilot_app, seopilot_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO seopilot_app, seopilot_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO seopilot_app, seopilot_worker;

-- pg-boss creates its own schema at first start; the worker needs to own it.
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO seopilot_worker, seopilot_app', current_database()); END $$;
