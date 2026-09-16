/**
 * Structured data extraction and validation (spec §22): JSON-LD, Microdata,
 * RDFa detection with required-property checks for the common schema.org
 * types. Validation is rule-based against Google's documented required
 * properties for rich results; it does not claim to be a full schema.org
 * validator and reports exactly which required properties are missing.
 */
import type { CheerioAPI } from "cheerio";
import type { StructuredDataItem } from "./types";

const REQUIRED: Record<string, string[]> = {
  Article: ["headline"],
  NewsArticle: ["headline"],
  BlogPosting: ["headline"],
  Product: ["name"],
  Offer: ["price", "priceCurrency"],
  Organization: ["name"],
  LocalBusiness: ["name", "address"],
  FAQPage: ["mainEntity"],
  Question: ["name", "acceptedAnswer"],
  BreadcrumbList: ["itemListElement"],
  ListItem: ["position"],
  WebSite: ["name", "url"],
  Person: ["name"],
  Event: ["name", "startDate", "location"],
  Recipe: ["name", "image"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
  HowTo: ["name", "step"],
  Review: ["itemReviewed", "reviewRating"],
  AggregateRating: ["ratingValue"],
  JobPosting: ["title", "description", "datePosted", "hiringOrganization", "jobLocation"],
  SoftwareApplication: ["name", "offers"],
  Course: ["name", "description", "provider"],
};

const RECOMMENDED: Record<string, string[]> = {
  Article: ["image", "datePublished", "author"],
  Product: ["image", "description", "offers", "sku", "brand"],
  Organization: ["url", "logo"],
  LocalBusiness: ["telephone", "openingHours", "geo", "url"],
  WebSite: ["potentialAction"],
  Person: ["url"],
  BreadcrumbList: [],
  FAQPage: [],
};

function typeOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t.replace(/^https?:\/\/schema\.org\//, "")];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, ""));
  return [];
}

function validateNode(node: Record<string, unknown>, type: string): string[] {
  const errors: string[] = [];
  for (const req of REQUIRED[type] ?? []) {
    const v = node[req];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) errors.push(`missing required property "${req}"`);
  }
  if (type === "FAQPage" && Array.isArray(node["mainEntity"])) {
    node["mainEntity"].forEach((q, i) => {
      if (!q || typeof q !== "object") return errors.push(`mainEntity[${i}] is not a Question`);
      const qq = q as Record<string, unknown>;
      if (!qq["name"]) errors.push(`mainEntity[${i}] missing "name"`);
      const a = qq["acceptedAnswer"] as Record<string, unknown> | undefined;
      if (!a || !a["text"]) errors.push(`mainEntity[${i}] missing acceptedAnswer.text`);
    });
  }
  if (type === "BreadcrumbList" && Array.isArray(node["itemListElement"])) {
    node["itemListElement"].forEach((li, i) => {
      const item = li as Record<string, unknown>;
      if (item["position"] === undefined) errors.push(`itemListElement[${i}] missing "position"`);
      const inner = item["item"];
      const hasName = item["name"] || (inner && typeof inner === "object" && (inner as Record<string, unknown>)["name"]);
      if (!hasName) errors.push(`itemListElement[${i}] missing "name"`);
    });
  }
  if (type === "Product") {
    const offers = node["offers"];
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
    offerList.forEach((o, i) => {
      const off = o as Record<string, unknown>;
      if (off["price"] === undefined && off["lowPrice"] === undefined) errors.push(`offers[${i}] missing "price"`);
      if (!off["priceCurrency"]) errors.push(`offers[${i}] missing "priceCurrency"`);
    });
  }
  return errors;
}

function flattenJsonLd(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) return value.forEach((v) => flattenJsonLd(v, out));
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (Array.isArray(node["@graph"])) flattenJsonLd(node["@graph"], out);
  if (node["@type"]) out.push(node);
}

export function extractStructuredData($: CheerioAPI): StructuredDataItem[] {
  const items: StructuredDataItem[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      items.push({ format: "json-ld", type: "unknown", valid: false, errors: [`invalid JSON: ${err instanceof Error ? err.message : "parse error"}`], warnings: [] });
      return;
    }
    const nodes: Record<string, unknown>[] = [];
    flattenJsonLd(parsed, nodes);
    if (nodes.length === 0) items.push({ format: "json-ld", type: "unknown", valid: false, errors: ["no @type found"], warnings: [] });
    for (const node of nodes) {
      for (const type of typeOf(node)) {
        const errors = validateNode(node, type);
        const recommended = (RECOMMENDED[type] ?? []).filter((k) => node[k] === undefined);
        items.push({ format: "json-ld", type, valid: errors.length === 0, errors: errors.slice(0, 20), warnings: recommended.map((k) => `recommended property "${k}" missing`), raw: nodes.length <= 20 ? node : undefined });
      }
    }
  });

  $("[itemscope][itemtype]").each((_, el) => {
    const itemtype = String($(el).attr("itemtype") ?? "");
    const type = itemtype.split("/").pop() ?? itemtype;
    const props = new Set<string>();
    $(el).find("[itemprop]").each((__, p) => {
      String($(p).attr("itemprop") ?? "").split(/\s+/).forEach((n) => n && props.add(n));
    });
    const errors = (REQUIRED[type] ?? []).filter((r) => !props.has(r)).map((r) => `missing required property "${r}"`);
    items.push({ format: "microdata", type, valid: errors.length === 0, errors, warnings: (RECOMMENDED[type] ?? []).filter((r) => !props.has(r)).map((r) => `recommended property "${r}" missing`) });
  });

  $("[typeof]").each((_, el) => {
    const type = String($(el).attr("typeof") ?? "").split(/\s+/)[0]?.split(":").pop() ?? "";
    if (!type) return;
    const props = new Set<string>();
    $(el).find("[property]").each((__, p) => {
      String($(p).attr("property") ?? "").split(/\s+/).forEach((n) => props.add(n.split(":").pop() ?? n));
    });
    const errors = (REQUIRED[type] ?? []).filter((r) => !props.has(r)).map((r) => `missing required property "${r}"`);
    items.push({ format: "rdfa", type, valid: errors.length === 0, errors, warnings: (RECOMMENDED[type] ?? []).filter((r) => !props.has(r)).map((r) => `recommended property "${r}" missing`) });
  });

  return items.slice(0, 100);
}

export const KNOWN_SCHEMA_TYPES = Object.keys(REQUIRED);
