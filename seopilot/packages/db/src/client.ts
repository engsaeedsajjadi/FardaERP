import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | Transaction;

let pool: Pool | null = null;
let db: Database | null = null;

function poolConfig(url: string): PoolConfig {
  return {
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: process.env.SERVICE_NAME ?? "seopilot",
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  };
}

/** Application connection: must be a NOSUPERUSER NOBYPASSRLS role in production (see docs/MULTI-TENANCY.md). */
export function getDb(): Database {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  pool = new Pool(poolConfig(url));
  pool.on("error", (err) => {
    // Idle client errors must not crash the process.
    console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: err.message }));
  });
  db = drizzle(pool, { schema, casing: "snake_case" });
  return db;
}

export function getPool(): Pool {
  getDb();
  return pool as Pool;
}

/** Elevated connection for migrations / RLS DDL. Falls back to DATABASE_URL in dev. */
export function createMigrationDb(): { db: Database; pool: Pool } {
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_MIGRATE_URL or DATABASE_URL is required");
  const p = new Pool({ ...poolConfig(url), max: 2 });
  return { db: drizzle(p, { schema, casing: "snake_case" }), pool: p };
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  db = null;
}

export { schema };
