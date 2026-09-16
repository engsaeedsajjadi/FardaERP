/**
 * Forward-only migration runner. Applies every `migrations/*.sql` file not yet
 * recorded in `_seopilot_migrations`, in lexical order, each inside its own
 * transaction. Already-applied files are checksum-verified so an edited
 * historical migration fails loudly instead of silently diverging (spec §68).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, "..", "migrations");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(connectionString: string, opts: { dir?: string; log?: (m: string) => void } = {}): Promise<MigrationResult> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? ((m: string) => console.log(m));
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _seopilot_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Serialise concurrent migrators (web + worker booting together).
    await client.query("SELECT pg_advisory_lock(727272)");
    try {
      const rows = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM _seopilot_migrations");
      const done = new Map(rows.rows.map((r) => [r.name, r.checksum]));
      const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const body = readFileSync(join(dir, file), "utf8");
        const checksum = createHash("sha256").update(body).digest("hex");
        const prev = done.get(file);
        if (prev) {
          if (prev !== checksum) throw new Error(`Migration ${file} was modified after being applied (checksum mismatch). Create a new forward migration instead.`);
          skipped.push(file);
          continue;
        }
        log(`applying ${file}`);
        await client.query("BEGIN");
        try {
          await client.query(body);
          await client.query("INSERT INTO _seopilot_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
          await client.query("COMMIT");
          applied.push(file);
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(727272)");
    }
  } finally {
    client.release();
    await pool.end();
  }
  return { applied, skipped };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_MIGRATE_URL or DATABASE_URL required");
    process.exit(1);
  }
  runMigrations(url)
    .then((r) => {
      console.log(`migrations applied: ${r.applied.length}, already applied: ${r.skipped.length}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
