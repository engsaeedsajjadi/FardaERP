import type { schema } from "@seopilot/db";
import type { JobHandler } from "../types";
import { aiVisibilityCheck } from "./ai";
import { siteCrawl } from "./crawl";
import { backlinkRefresh, competitorCheck, ga4Sync, gscSync, keywordRefresh, pagespeedCheck } from "./data";
import { rankCheck } from "./rank";
import { alertProcessing, emailDelivery, orgDeletion, webhookDelivery } from "./system";

const notWired = (type: string): JobHandler => async () => {
  throw new Error(`${type} handler is registered by a later phase package (reports/exports) — job cannot run until it is wired`);
};

export const handlers: Record<schema.JobType, JobHandler> = {
  SITE_CRAWL: siteCrawl as JobHandler,
  RANK_CHECK: rankCheck as JobHandler,
  KEYWORD_REFRESH: keywordRefresh as JobHandler,
  BACKLINK_REFRESH: backlinkRefresh as JobHandler,
  GSC_SYNC: gscSync as JobHandler,
  GA4_SYNC: ga4Sync as JobHandler,
  PAGESPEED_CHECK: pagespeedCheck as JobHandler,
  COMPETITOR_CHECK: competitorCheck as JobHandler,
  AI_VISIBILITY_CHECK: aiVisibilityCheck as JobHandler,
  REPORT_GENERATION: notWired("REPORT_GENERATION"),
  ALERT_PROCESSING: alertProcessing as JobHandler,
  WEBHOOK_DELIVERY: webhookDelivery as JobHandler,
  EMAIL_DELIVERY: emailDelivery as JobHandler,
  DATA_EXPORT: notWired("DATA_EXPORT"),
  ORG_DELETION: orgDeletion as JobHandler,
  SCHEDULE_TICK: async () => ({}), // replaced by scheduleTickHandler in runtime (no tenant context)
};
