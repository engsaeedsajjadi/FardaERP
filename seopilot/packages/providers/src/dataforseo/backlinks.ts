import type { BacklinkAnchorRow, BacklinkProvider, BacklinkRow, BacklinkSummary, ProviderCall } from "../types";
import { DataForSeoClient, firstResult, itemsOf, num, rec, str } from "./client";

function targetPayload(target: string): Record<string, unknown> {
  // Domain targets are scoped to the whole site (with subdomains); URL targets are exact.
  const isUrl = /^https?:\/\//i.test(target);
  return isUrl ? { target, mode: "as_is" } : { target: target.replace(/^www\./, ""), include_subdomains: true, exclude_internal_backlinks: true };
}

export class DataForSeoBacklinkProvider implements BacklinkProvider {
  readonly name = "dataforseo";
  constructor(private readonly client: DataForSeoClient) {}

  async summary(target: string): Promise<ProviderCall<BacklinkSummary>> {
    const endpoint = "/v3/backlinks/summary/live";
    const { task, cost } = await this.client.postTask<Record<string, unknown>>(endpoint, { ...targetPayload(target), internal_list_limit: 10, backlinks_status_type: "live" });
    const r = firstResult(task);
    const data: BacklinkSummary = {
      target,
      backlinks: r ? num(r["backlinks"]) : null,
      referringDomains: r ? num(r["referring_domains"]) : null,
      referringIps: r ? num(r["referring_ips"]) : null,
      dofollow: r ? num(rec(r["referring_links_attributes"])?.["dofollow"]) : null,
      nofollow: r ? num(rec(r["referring_links_attributes"])?.["nofollow"]) : null,
      domainRank: r ? num(r["rank"]) : null,
      brokenBacklinks: r ? num(r["broken_backlinks"]) : null,
      referringDomainsNofollow: r ? num(r["referring_domains_nofollow"]) : null,
    };
    if (data.dofollow === null && data.backlinks !== null && data.nofollow !== null) data.dofollow = data.backlinks - data.nofollow;
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async backlinks(target: string, limit: number, offset = 0): Promise<ProviderCall<BacklinkRow[]>> {
    const endpoint = "/v3/backlinks/backlinks/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { ...targetPayload(target), limit: Math.min(limit, 1000), offset, order_by: ["rank,desc"], backlinks_status_type: "all" });
    const data: BacklinkRow[] = [];
    for (const it of itemsOf(task)) {
      const sourceUrl = str(it["url_from"]);
      const targetUrl = str(it["url_to"]);
      if (!sourceUrl || !targetUrl) continue;
      data.push({
        sourceUrl,
        sourceDomain: str(it["domain_from"]) ?? new URL(sourceUrl).hostname,
        targetUrl,
        anchor: str(it["anchor"]),
        isDofollow: it["dofollow"] !== false,
        linkType: str(it["item_type"]),
        domainRank: num(it["domain_from_rank"]),
        pageRank: num(it["page_from_rank"]),
        firstSeen: str(it["first_seen"]),
        lastSeen: str(it["last_seen"]),
        isLost: Boolean(it["is_lost"]),
        spamScore: num(it["backlink_spam_score"]),
      });
    }
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async anchors(target: string, limit: number): Promise<ProviderCall<BacklinkAnchorRow[]>> {
    const endpoint = "/v3/backlinks/anchors/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { ...targetPayload(target), limit: Math.min(limit, 1000), order_by: ["backlinks,desc"] });
    const data = itemsOf(task)
      .map((it) => ({ anchor: str(it["anchor"]) ?? "", backlinks: num(it["backlinks"]) ?? 0, referringDomains: num(it["referring_domains"]) ?? 0 }))
      .filter((a) => a.backlinks > 0);
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }

  async referringDomains(target: string, limit: number) {
    const endpoint = "/v3/backlinks/referring_domains/live";
    const { task, cost } = await this.client.postTask<{ items?: Record<string, unknown>[] | null }>(endpoint, { ...targetPayload(target), limit: Math.min(limit, 1000), order_by: ["rank,desc"] });
    const data = itemsOf(task)
      .map((it) => ({ domain: str(it["domain"]) ?? "", backlinks: num(it["backlinks"]) ?? 0, rank: num(it["rank"]), firstSeen: str(it["first_seen"]) }))
      .filter((d) => d.domain);
    return { data, provider: this.name, cost, fetchedAt: new Date() };
  }
}
