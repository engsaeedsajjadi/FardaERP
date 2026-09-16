# Source Repository Audit (Phase 1)

Audit date: 2026-09-16. All three reference repositories were cloned at `--depth 1` and inspected
before any SEOPilot code was written. Commit hashes recorded so that any reused segment can be traced.

| Repository | Commit | License (LICENSE file) | package.json `license` | Verdict |
|---|---|---|---|---|
| https://github.com/every-app/open-seo | `7b9ee0e4fa800e5bae9ca76f49cb273a9c677204` | MIT (c) 2026 Ben Senescu | not declared (private) | MIT — compatible |
| https://github.com/open-saas-org/RosterSeo | `71b9dad4dff7d3a3f8ad6ebbffa8d126aa27172c` | MIT (c) 2026 RosterSEO contributors | `MIT` | MIT — compatible |
| https://github.com/fenjo26/opengsc | `4a1e0e1098a756d025c120c705e805b86ef5684c` | MIT (c) 2026 OpenGSC | not declared (private) | MIT — compatible |

SEOPilot itself is MIT. Any code segment adapted from these repos keeps its MIT attribution in
`docs/LICENSE-AUDIT.md` and in a file-level header comment where the adaptation is substantial.

## Method

1. Read the top-level layout, `package.json`, docs and architecture files of each repo.
2. Located the modules relevant to the SEOPilot spec (crawler, SSRF guard, audit rules, DataForSEO client,
   RLS, job queue, GSC/GA4/PageSpeed clients, MCP).
3. Classified each as **Pattern only** (idea reused, code rewritten), **Adapted** (code rewritten with
   structural similarity, attributed) or **Rejected** (not used).
4. Checked the license of every third-party dependency those modules pull in.

## OpenSEO (every-app/open-seo)

Stack: TanStack Start + Cloudflare Workers/D1/R2, better-auth, Drizzle (D1 + PG dual schema), DataForSEO,
Autumn billing, MCP via `@modelcontextprotocol/sdk` + Cloudflare OAuth provider. ~120k LOC.

| Path | Function | Reusable? | License | Deps | Risk | SEOPilot target |
|---|---|---|---|---|---|---|
| `src/server/lib/audit/url-policy.ts` | SSRF host/IP policy for crawl start URL + redirects (DoH resolution) | Pattern only | MIT | none (fetch) | DoH via Cloudflare is a CF-runtime workaround; Node can use `dns.lookup` and pin sockets | `packages/security/src/ssrf.ts` (Node-native, pinned-IP dial) |
| `src/server/lib/audit/page-analyzer.ts` | Streaming htmlparser2 page extractor (title, meta, headings, images, links, canonical, OG, hreflang, word count) | Pattern only | MIT | htmlparser2 (MIT) | Designed around 128 MB isolate memory limits; SEOPilot uses Cheerio + streaming byte cap | `packages/crawler/src/analyze.ts` |
| `src/server/lib/audit/issues/page-reporters.ts` | Per-page pure issue reporters | Pattern only (rule thresholds: title 10–60, meta 70–160, thin < 150 words, slow > 1500 ms) | MIT | none | none | `packages/audit/src/rules/*` (one file per rule, severity/category/evidence/docs per spec §12) |
| `src/server/lib/audit/issues/multipage-checks.ts` | Duplicate grouping, redirect chain/loop detection, canonical-aware dedupe candidates | Pattern only | MIT | none | none | `packages/audit/src/rules/site/*` |
| `src/shared/audit-issues.ts` | Issue registry (severity/title/explanation/howToFix) | Pattern only; copy text rewritten | MIT | none | none | `packages/audit/src/registry.ts` |
| `src/server/lib/dataforseo/core.ts` | Authenticated fetch, retry idempotent reads on 5xx, timeout classification | Adapted (retry/timeout structure) | MIT | zod (MIT) | none | `packages/providers/src/dataforseo/http.ts` |
| `src/server/lib/dataforseo/serp.ts` | `stop_crawl_on_match`, rank_group organic match with subdomains | Pattern only | MIT | zod | none | `packages/providers/src/dataforseo/serp.ts` |
| `src/server/lib/dataforseo/labs.ts`, `google-ads.ts`, `backlinks.ts`, `ai.ts` | Endpoint wrappers for Labs, Ads, Backlinks, LLM mentions | Pattern only (endpoint paths + payload shapes verified against DataForSEO docs) | MIT | zod | Endpoint contracts owned by DataForSEO, not the repo | `packages/providers/src/dataforseo/*` |
| `src/server/lib/dataforseo/client.ts` | Billing-metered provider client wrapper (`meter()`) | Pattern only | MIT | — | Coupled to Autumn billing | `packages/usage/src/metered.ts` (credit ledger, not Autumn) |
| `src/server/workflows/RankCheckWorkflow.ts` | Cloudflare Workflow rank check | Rejected | MIT | CF Workflows | CF-only runtime | pg-boss job in `apps/worker` |
| `src/server/mcp/*` | MCP tool set + OAuth provider | Pattern only (tool naming/scoping) | MIT | `@modelcontextprotocol/sdk` (MIT), CF OAuth provider | CF KV-bound OAuth | `apps/mcp` uses API keys with scopes |
| `src/lib/auth.ts` | better-auth config with API-key plugin, org plugin | Pattern only | MIT | better-auth (MIT) | — | `packages/auth` |
| `src/server/gdpr/*` | User erasure script | Pattern only | MIT | — | — | `packages/db/src/gdpr.ts` |
| `src/shared/keyword-locations.ts` | DataForSEO location-code table (862 lines) | Rejected — data is DataForSEO's; SEOPilot fetches `/v3/serp/google/locations` live and caches | MIT | — | Stale data | `packages/providers/src/dataforseo/locations.ts` |
| Autumn billing (`autumn-js`) | Hosted billing SaaS | Rejected | MIT | third-party SaaS | Spec requires Stripe | `packages/billing` (Stripe) |

## RosterSeo (open-saas-org/RosterSeo)

Stack: pnpm + Turborepo monorepo, Next.js App Router, better-auth, Drizzle + Postgres RLS, pg-boss,
`apps/{web,worker,mcp-server,docs}`, `packages/{db,crawler,dataforseo,google,ai-visibility,jobs,...}`.
Self-hosted single-tenant today; no Stripe. This is the closest architectural match to the spec.

| Path | Function | Reusable? | License | Deps | Risk | SEOPilot target |
|---|---|---|---|---|---|---|
| `ARCHITECTURE.md` | Modular monolith + worker, RLS scoped by user via memberships, `DATABASE_URL` (NOBYPASSRLS) vs `DATABASE_MIGRATE_URL` | Pattern adopted | MIT | — | none | `docs/ARCHITECTURE.md`, `docs/MULTI-TENANCY.md` |
| `packages/db/drizzle/0001_rls_policies.sql` | RLS policy shape: `current_setting('app.current_user_id')`, `FORCE ROW LEVEL SECURITY`, self-referential membership policy caveat | Adapted (policy SQL rewritten for SEOPilot schema, attributed) | MIT | — | Self-join recursion pitfall documented | `packages/db/migrations/0002_rls.sql` |
| `packages/db/src/with-user-context.ts` | `set_config('app.current_user_id', $1, true)` inside a transaction | Adapted (small, attributed) | MIT | drizzle-orm (Apache-2.0) | — | `packages/db/src/tenant.ts` |
| `packages/crawler/src/ssrf-guard.ts` | CIDR list, IPv6 handling, DNS answer checking; explicitly notes it does NOT handle DNS rebinding | Adapted + hardened (pinned-IP connect closes the rebinding gap) | MIT | node:dns/net | Documented gap fixed in SEOPilot | `packages/security/src/ssrf.ts` |
| `packages/crawler/src/fetch-and-parse.ts` | Cheerio single-page fetch + parse with JSON-LD extraction | Pattern only | MIT | cheerio (MIT) | — | `packages/crawler/src/analyze.ts` |
| `packages/jobs/src/define-job.ts` | Typed pg-boss queue wrapper with `ensureQueue` (create + update, since `createQueue` is create-only) | Adapted (attributed) | MIT | pg-boss (MIT), zod | — | `packages/scheduler/src/define-job.ts` |
| `apps/worker/src/index.ts` | One `work()` per job, Sentry capture, never crash on job failure | Pattern only | MIT | @sentry/node (MIT) | — | `apps/worker/src/index.ts` |
| `apps/web/lib/api-utils.ts` | `withAuth` + `requireProjectAccess` inside RLS transaction | Pattern only | MIT | — | — | `packages/api/src/handler.ts` |
| `packages/google/src/pagespeed.ts` | PSI v5 fetch | Pattern only — the original coerces missing metrics to `0`, which violates spec §2 (no fabricated data); SEOPilot stores `null` | MIT | — | Falsifies data on failure | `packages/pagespeed` |
| `packages/google/src/ga4-*.ts`, `search-console-sites.ts` | GA4 Data API / GSC via googleapis | Pattern only | MIT | googleapis (Apache-2.0) | — | `packages/gsc`, `packages/ga4` (REST, no googleapis dependency) |
| `packages/ai-visibility/src/providers/*` | Per-LLM provider callers for brand visibility | Pattern only | MIT | provider SDKs | BrightData scraping of ChatGPT UI rejected (ToS risk) | `packages/geo` uses official APIs only |
| `packages/publishing`, `packages/social`, `packages/shopify`, `packages/wordpress`, `packages/indexnow`, `packages/bing` | Publishing/social integrations | Rejected (out of spec scope) | MIT | — | — | — |

## OpenGSC (fenjo26/opengsc)

Stack: Next.js + Prisma/SQLite (MySQL optional), next-auth, single-workspace tool with team roles, GSC-centric
analytics (striking distance, decay, cannibalization), SERP monitor, provider call log with redaction.

| Path | Function | Reusable? | License | Deps | Risk | SEOPilot target |
|---|---|---|---|---|---|---|
| `src/lib/security/safeFetch.ts` | Hardened HTTP client: pinned-address dial via custom agent, response byte cap, redirect re-validation, proxy hook, no credentials in URL | Adapted + attributed (strongest SSRF implementation of the three) | MIT | node:http/https/tls/dns, undici (MIT) | — | `packages/security/src/safe-fetch.ts` |
| `src/lib/providerLog/redact.ts`, `tokens.ts` | Secret redaction in provider logs | Pattern only | MIT | — | — | `packages/shared/src/redact.ts` |
| `src/lib/cannibalization/relatedIntent.ts` | Query/page cannibalization grouping from GSC rows | Pattern only | MIT | — | — | `packages/gsc/src/insights/cannibalization.ts` |
| `src/lib/sitemap/{inventory,diff,metadata}.ts` | Sitemap inventory + diff between runs, lastmod analysis | Pattern only | MIT | — | — | `packages/crawler/src/sitemap.ts` |
| `src/lib/audit/rules.ts` | Page-level audit rules | Pattern only | MIT | — | — | `packages/audit` |
| `src/app/striking`, `src/app/decay` | Striking-distance (pos 8–20) and content-decay logic | Pattern only | MIT | — | — | `packages/gsc/src/insights/*` |
| `src/lib/seo/metrics.ts` | Semrush/Ahrefs/Majestic paid API wrappers | Rejected (different provider set; DataForSEO first) | MIT | — | — | — |
| `src/lib/drops/*` | Expired-domain hunting | Rejected (out of scope; borderline black-hat per spec §62) | MIT | — | — | — |
| `src/lib/mcp/*` | MCP tools over workspace data | Pattern only | MIT | — | — | `apps/mcp` |
| Prisma schema / next-auth | ORM/auth | Rejected (spec mandates Drizzle + Better Auth) | MIT | — | — | — |

## Third-party dependency licenses (SEOPilot runtime)

| Package | License | Note |
|---|---|---|
| next, react, react-dom | MIT | |
| drizzle-orm, drizzle-kit | Apache-2.0 | compatible |
| better-auth | MIT | |
| pg, pg-boss | MIT | |
| cheerio, htmlparser2 | MIT | |
| playwright | Apache-2.0 | optional JS rendering |
| zod | MIT | |
| stripe | MIT | |
| @modelcontextprotocol/sdk | MIT | |
| @aws-sdk/client-s3 | Apache-2.0 | |
| pino | MIT | |
| nodemailer | MIT-0 | |
| pdfkit | MIT | |
| robots-parser | MIT | |
| fast-xml-parser | MIT | |
| tailwindcss | MIT | |
| lucide-react | ISC | |
| recharts | MIT | |
| vitest, playwright/test | MIT / Apache-2.0 | dev |

No GPL/AGPL/SSPL dependency is introduced. The parent repository (FardaERP/ERPNext) is GPL-3.0; SEOPilot lives
in an isolated subdirectory with its own `package.json`, lockfile, `LICENSE` and does not import from it.

## Decisions taken from the audit

1. **Architecture** follows RosterSeo's shape (pnpm workspace, `apps/web|worker|mcp`, `packages/*`, pg-boss,
   Drizzle RLS) because it matches spec §4–5 exactly and is battle-tested by that project.
2. **Crawler** takes OpenSEO's per-page reporter/multipage split and RosterSeo's Cheerio parsing, on top of an
   OpenGSC-grade `safeFetch` (pinned IP, byte cap, redirect revalidation) — the only one of the three that
   addresses DNS rebinding.
3. **DataForSEO** payload/endpoint knowledge from OpenSEO is reused, but wrapped behind SEOPilot's
   `KeywordProvider / SerpProvider / BacklinkProvider / RankProvider` interfaces (spec §60) and metered into a
   first-party credit ledger (spec §38) rather than Autumn.
4. **Billing** is Stripe-native; none of the three repos has a reusable Stripe implementation.
5. **Data honesty**: RosterSeo's PageSpeed wrapper coerces failures to `0` — that pattern is explicitly not reused.
