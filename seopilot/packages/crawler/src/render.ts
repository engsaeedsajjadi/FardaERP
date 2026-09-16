/**
 * Optional JavaScript rendering through Playwright (spec §10). Playwright is an
 * optional dependency; when it is not installed or PLAYWRIGHT_ENABLED is false
 * the renderer reports "not available" and the crawler records pages as
 * non-rendered rather than silently degrading.
 *
 * Rendering happens *after* the SSRF-safe raw fetch succeeded for the same
 * URL, and the browser is launched with request interception that blocks any
 * navigation/sub-request to a private address (defence against a page that
 * loads http://169.254.169.254 as an image or XHR).
 */
import { assertUrlPolicy, type SsrfPolicy } from "@seopilot/security";

export interface RenderResult {
  html: string;
  status: number | null;
  durationMs: number;
}

type PlaywrightModule = typeof import("playwright");

let browserPromise: Promise<import("playwright").Browser> | null = null;

export async function isRenderingAvailable(): Promise<boolean> {
  if (process.env.PLAYWRIGHT_ENABLED !== "true") return false;
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

async function getBrowser(): Promise<import("playwright").Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const pw = (await import("playwright")) as PlaywrightModule;
      return pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
    })();
  }
  return browserPromise;
}

export async function renderPage(url: string, opts: { userAgent: string; timeoutMs?: number; policy?: SsrfPolicy }): Promise<RenderResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: opts.userAgent, javaScriptEnabled: true, viewport: { width: 1366, height: 900 } });
  const started = Date.now();
  try {
    await context.route("**/*", (route) => {
      const target = route.request().url();
      try {
        assertUrlPolicy(target, opts.policy);
        void route.continue();
      } catch {
        void route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeoutMs ?? 30_000 });
    const html = await page.content();
    return { html, status: response?.status() ?? null, durationMs: Date.now() - started };
  } finally {
    await context.close();
  }
}

export async function closeRenderer(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
