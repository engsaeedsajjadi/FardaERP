#!/usr/bin/env node
// Create (or recreate with --reset) a database on the server pointed to by ADMIN_DATABASE_URL.
// Usage: node scripts/db-create.mjs seopilot [--reset]
import pg from "pg";
const admin = process.env.ADMIN_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const name = process.argv[2];
if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) { console.error("usage: db-create.mjs <db_name> [--reset]"); process.exit(1); }
const c = new pg.Client({ connectionString: admin });
await c.connect();
if (process.argv.includes("--reset")) await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
if (exists.rowCount === 0) { await c.query(`CREATE DATABASE ${name}`); console.log("created", name); } else console.log("exists", name);
await c.end();
