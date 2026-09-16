import { z } from "zod";

/**
 * Central, typed environment access. Every process (web, worker, mcp) validates
 * only the variables it needs via `readEnv(schema)`; optional provider variables
 * are modelled as optional so a missing provider yields an explicit
 * "not configured" state instead of a crash or a fabricated value.
 */
const bool = (def: "true" | "false") =>
  z
    .enum(["true", "false", "1", "0"])
    .default(def)
    .transform((v) => v === "true" || v === "1");

export const coreEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_ENV: z.enum(["development", "test", "staging", "production"]).optional(),
  APP_NAME: z.string().default("SEOPilot"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATE_URL: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SELF_HOSTED: bool("false"),
  /** 32-byte base64 key used for AES-256-GCM encryption of stored credentials. */
  ENCRYPTION_KEY: z.string().min(32),
});

export const authEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export const providerEnvSchema = z.object({
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  SERPAPI_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),
  GOOGLE_PAGESPEED_API_KEY: z.string().optional(),
});

export const billingEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool("true"),
  /** Local filesystem fallback for self-hosted mode when S3 is not configured. */
  STORAGE_LOCAL_DIR: z.string().optional(),
});

export const emailEnvSchema = z.object({
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool("false"),
  EMAIL_FROM: z.string().optional(),
});

export const observabilityEnvSchema = z.object({
  SENTRY_DSN: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().optional(),
});

export const workerEnvSchema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  CRAWLER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(5),
  CRAWLER_USER_AGENT: z.string().default("SEOPilotBot/1.0 (+https://seopilot.dev/bot)"),
  PLAYWRIGHT_ENABLED: bool("false"),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;

const cache = new Map<z.ZodTypeAny, unknown>();

/**
 * Parse `process.env` against a schema. Result is cached per schema object so
 * hot paths can call it freely. Throws a descriptive error listing the missing
 * variables (never their values).
 */
export function readEnv<S extends z.ZodTypeAny>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  if (source === process.env && cache.has(schema)) return cache.get(schema) as z.infer<S>;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (source === process.env) cache.set(schema, parsed.data);
  return parsed.data;
}

export function resetEnvCache(): void {
  cache.clear();
}

export function isProduction(): boolean {
  return (process.env.APP_ENV ?? process.env.NODE_ENV) === "production";
}
