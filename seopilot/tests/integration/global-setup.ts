/**
 * Integration test bootstrap: requires a reachable PostgreSQL server via
 * TEST_ADMIN_DATABASE_URL (superuser) — creates a fresh `seopilot_test`
 * database, runs migrations, creates the restricted `seopilot_app` role
 * password and exports DATABASE_URL / DATABASE_MIGRATE_URL for the tests.
 *
 * Tests never run against the superuser connection: RLS must be proven with
 * a NOBYPASSRLS role, exactly like production.
 */
import pg from "pg";
import { runMigrations } from "../../packages/db/src/migrate";

const admin = process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const dbName = process.env.TEST_DATABASE_NAME ?? "seopilot_test";
const appPassword = "seopilot_test_app_pw";

export default async function setup(): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${dbName}`);
  await client.end();

  const adminUrl = new URL(admin);
  adminUrl.pathname = `/${dbName}`;
  const migrateUrl = adminUrl.toString();
  await runMigrations(migrateUrl, { log: () => {} });

  const c2 = new pg.Client({ connectionString: migrateUrl });
  await c2.connect();
  await c2.query(`ALTER ROLE seopilot_app PASSWORD '${appPassword}'`);
  await c2.query(`ALTER ROLE seopilot_worker PASSWORD '${appPassword}'`);
  await c2.end();

  const appUrl = new URL(migrateUrl);
  appUrl.username = "seopilot_app";
  appUrl.password = appPassword;
  const workerUrl = new URL(migrateUrl);
  workerUrl.username = "seopilot_worker";
  workerUrl.password = appPassword;

  process.env.DATABASE_URL = appUrl.toString();
  process.env.DATABASE_WORKER_URL = workerUrl.toString();
  process.env.DATABASE_MIGRATE_URL = migrateUrl;
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=";
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "test-better-auth-secret-at-least-32-chars-long";
  process.env.APP_URL = process.env.APP_URL ?? "http://localhost:3000";
  process.env.NODE_ENV = "test";

  return async () => {
    /* keep the database for inspection; next run recreates it */
  };
}
