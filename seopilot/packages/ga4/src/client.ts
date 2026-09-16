import { googleApiError, type FetchLike } from "@seopilot/gsc";

const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

export interface Ga4Property {
  propertyId: string; // properties/123
  displayName: string;
  accountName: string | null;
}

export interface RunReportInput {
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  dimensionFilter?: unknown;
  limit?: number;
  offset?: number;
  orderBys?: unknown[];
}

export interface RunReportRow {
  dimensions: string[];
  metrics: number[];
}

export class Ga4Client {
  constructor(private readonly accessToken: string, private readonly fetchImpl: FetchLike = fetch) {}
  private headers() {
    return { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" };
  }

  async listProperties(): Promise<Ga4Property[]> {
    const out: Ga4Property[] = [];
    let pageToken: string | undefined;
    do {
      const u = new URL(`${ADMIN_API}/accountSummaries`);
      u.searchParams.set("pageSize", "200");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const res = await this.fetchImpl(u.toString(), { headers: this.headers() });
      if (!res.ok) throw await googleApiError(res, "Google Analytics");
      const json = (await res.json()) as { accountSummaries?: Array<{ displayName?: string; propertySummaries?: Array<{ property: string; displayName?: string }> }>; nextPageToken?: string };
      for (const a of json.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.push({ propertyId: p.property, displayName: p.displayName ?? p.property, accountName: a.displayName ?? null });
      pageToken = json.nextPageToken;
    } while (pageToken && out.length < 2000);
    return out;
  }

  async runReport(propertyId: string, input: RunReportInput): Promise<{ rows: RunReportRow[]; rowCount: number }> {
    if (!/^properties\/\d+$/.test(propertyId)) throw new Error(`invalid GA4 property id ${propertyId}`);
    const res = await this.fetchImpl(`${DATA_API}/${propertyId}:runReport`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        dimensions: input.dimensions.map((name) => ({ name })),
        metrics: input.metrics.map((name) => ({ name })),
        dimensionFilter: input.dimensionFilter,
        limit: String(Math.min(input.limit ?? 10000, 100000)),
        offset: String(input.offset ?? 0),
        orderBys: input.orderBys,
        keepEmptyRows: false,
      }),
    });
    if (!res.ok) throw await googleApiError(res, "Google Analytics");
    const json = (await res.json()) as { rows?: Array<{ dimensionValues?: Array<{ value: string }>; metricValues?: Array<{ value: string }> }>; rowCount?: number };
    return { rows: (json.rows ?? []).map((r) => ({ dimensions: (r.dimensionValues ?? []).map((d) => d.value), metrics: (r.metricValues ?? []).map((m) => Number(m.value)) })), rowCount: json.rowCount ?? 0 };
  }
}

export const ORGANIC_FILTER = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } } };
