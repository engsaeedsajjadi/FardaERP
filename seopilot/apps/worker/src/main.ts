import { createServer } from "node:http";
import { getDb, runMigrations } from "@seopilot/db";
import { logger, readEnv, workerEnvSchema } from "@seopilot/shared";
import { handlers } from "./handlers";
import { createBoss, startWorker } from "./runtime";

async function main() {
  const env = readEnv(workerEnvSchema);
  if (process.env.RUN_MIGRATIONS_ON_START === "true") await runMigrations(process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL!, { log: (m) => logger.info(m) });
  getDb();
  const boss = createBoss();
  boss.on("error", (err) => logger.error({ err: err.message }, "pgboss.error"));
  const worker = await startWorker(boss, handlers, { concurrency: env.WORKER_CONCURRENCY });

  // Liveness/readiness for container orchestration.
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 9464);
  const server = createServer((req, res) => {
    if (req.url === "/healthz") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return; }
    res.writeHead(404); res.end();
  }).listen(port, "0.0.0.0", () => logger.info({ port }, "worker.health_listening"));

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "worker.shutdown");
    server.close();
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.stack : String(err) }, "worker.crashed");
  process.exit(1);
});
