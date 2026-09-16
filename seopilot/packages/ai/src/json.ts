import type { ZodType } from "zod";
import { AppError } from "@seopilot/shared";

/** Extract the first JSON object/array from model text (tolerates ``` fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
    const start = Math.min(...["{", "["].map((ch) => trimmed.indexOf(ch)).filter((i) => i >= 0));
    if (!Number.isFinite(start)) continue;
    const endObj = trimmed.lastIndexOf("}"), endArr = trimmed.lastIndexOf("]");
    const end = Math.max(endObj, endArr);
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new AppError("PROVIDER_ERROR", "AI response was not valid JSON", { provider: "ai" }, { reportable: false });
}

export function parseStructured<T>(text: string, schema: ZodType<T>): T {
  const raw = extractJson(text);
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError("PROVIDER_ERROR", "AI response did not match the expected structure", { provider: "ai", issues: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { reportable: false });
  return r.data;
}
