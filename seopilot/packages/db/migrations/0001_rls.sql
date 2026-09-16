-- Row-Level Security for tenant isolation (spec §6, §50).
--
-- Policy model adapted from RosterSeo packages/db/drizzle/0001_rls_policies.sql (MIT):
--   * identity comes from transaction-local settings set by @seopilot/db withTenant():
--       app.current_user_id   – authenticated user id (session auth)
--       app.current_org_id    – organization id (API-key auth, or narrowed session)
--       app.bypass_rls        – 'on' only for the worker/system context
--   * membership is resolved through a SECURITY DEFINER helper so organization_members'
--     own policy can be strict (user sees only their own membership rows) without the
--     self-referential recursion Postgres would otherwise hit.
--   * FORCE ROW LEVEL SECURITY so table owners in self-hosted deployments are also bound.
--   * When no context is set, every policy evaluates to false: fails closed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_org_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on' $$;

-- Organizations visible to the current identity. SECURITY DEFINER so it can read
-- organization_members regardless of that table's own policy. Agency members also
-- see client organizations whose parent is one of their organizations (kind = 'client').
CREATE OR REPLACE FUNCTION app_visible_org_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH direct AS (
    SELECT om.organization_id FROM organization_members om WHERE om.user_id = app_current_user_id()
    UNION
    SELECT app_current_org_id() WHERE app_current_org_id() IS NOT NULL
  )
  SELECT organization_id FROM direct
  UNION
  SELECT o.id FROM organizations o
    JOIN direct d ON o.parent_organization_id = d.organization_id
    JOIN organization_members om ON om.organization_id = d.organization_id AND om.user_id = app_current_user_id()
   WHERE om.role IN ('owner','admin','manager','seo_manager')
$$;

REVOKE ALL ON FUNCTION app_visible_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_visible_org_ids() TO PUBLIC;

CREATE OR REPLACE FUNCTION app_can_access_org(org_id text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_bypass_rls() OR org_id IN (SELECT app_visible_org_ids())
$$;

-- Project-level narrowing: members with a non-null project_ids array (clients,
-- contractors) only see those projects. API keys may also be scoped to projects.
CREATE OR REPLACE FUNCTION app_can_access_project(p_project_id text, p_org_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_bypass_rls()
    OR (
      app_can_access_org(p_org_id)
      AND NOT EXISTS (
        SELECT 1 FROM organization_members om
         WHERE om.organization_id = p_org_id
           AND om.user_id = app_current_user_id()
           AND om.project_ids IS NOT NULL
           AND NOT (om.project_ids ? p_project_id)
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_select ON organizations FOR SELECT USING (app_can_access_org(id) OR owner_user_id = app_current_user_id());
-- Any authenticated user may create an organization they own (signup bootstrap).
CREATE POLICY org_insert ON organizations FOR INSERT WITH CHECK (app_bypass_rls() OR owner_user_id = app_current_user_id());
CREATE POLICY org_update ON organizations FOR UPDATE USING (app_can_access_org(id));
CREATE POLICY org_delete ON organizations FOR DELETE USING (app_bypass_rls() OR owner_user_id = app_current_user_id());

-- organization_members: a user sees their own memberships plus the memberships of
-- organizations they can access (team listing) — via the definer function, no recursion.
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
CREATE POLICY om_select ON organization_members FOR SELECT USING (user_id = app_current_user_id() OR app_can_access_org(organization_id));
-- Bootstrap: the owner inserts their own membership right after creating the org.
CREATE POLICY om_insert ON organization_members FOR INSERT WITH CHECK (
  app_bypass_rls()
  OR app_can_access_org(organization_id)
  OR (user_id = app_current_user_id() AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_id AND o.owner_user_id = app_current_user_id()))
);
CREATE POLICY om_update ON organization_members FOR UPDATE USING (app_can_access_org(organization_id));
CREATE POLICY om_delete ON organization_members FOR DELETE USING (app_can_access_org(organization_id) OR user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- Organization-scoped tables
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_invitations_all ON organization_invitations USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY api_keys_all ON api_keys USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE white_label_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE white_label_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY white_label_settings_all ON white_label_settings USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE feature_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY feature_flag_overrides_all ON feature_flag_overrides USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_all ON jobs USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY job_attempts_all ON job_attempts USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY schedules_all ON schedules USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_rules_all ON notification_rules USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_all ON notifications USING (app_bypass_rls() OR (app_can_access_org(organization_id) AND (user_id IS NULL OR user_id = app_current_user_id() OR app_current_user_id() IS NULL))) WITH CHECK (app_bypass_rls() OR (app_can_access_org(organization_id) AND (user_id IS NULL OR user_id = app_current_user_id() OR app_current_user_id() IS NULL)));
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;
CREATE POLICY webhooks_all ON webhooks USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_all ON webhook_deliveries USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_all ON subscriptions USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_all ON invoices USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_all ON payments USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_wallets FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_wallets_all ON credit_wallets USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_transactions_all ON credit_transactions USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_records_all ON usage_records USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_runs_all ON ai_runs USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY data_exports_all ON data_exports USING (app_bypass_rls() OR (organization_id IS NOT NULL AND app_can_access_org(organization_id)) OR (user_id IS NOT NULL AND user_id = app_current_user_id())) WITH CHECK (app_bypass_rls() OR (organization_id IS NOT NULL AND app_can_access_org(organization_id)) OR (user_id IS NOT NULL AND user_id = app_current_user_id()));
ALTER TABLE report_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY report_shares_all ON report_shares USING (app_can_access_org(organization_id)) WITH CHECK (app_can_access_org(organization_id));
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING (app_can_access_org(organization_id));
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (app_bypass_rls() OR organization_id IS NULL OR app_can_access_org(organization_id));
CREATE POLICY audit_logs_update ON audit_logs FOR UPDATE USING (app_bypass_rls());
CREATE POLICY audit_logs_delete ON audit_logs FOR DELETE USING (app_bypass_rls());

-- Project-scoped tables (organization_id is denormalised onto every row for cheap policy checks)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_all ON projects USING (app_can_access_project(id, organization_id)) WITH CHECK (app_can_access_project(id, organization_id));
ALTER TABLE websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE websites FORCE ROW LEVEL SECURITY;
CREATE POLICY websites_all ON websites USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors FORCE ROW LEVEL SECURITY;
CREATE POLICY competitors_all ON competitors USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE project_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY project_integrations_all ON project_integrations USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE crawl_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY crawl_runs_all ON crawl_runs USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE crawl_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY crawl_pages_all ON crawl_pages USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE crawl_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_links FORCE ROW LEVEL SECURITY;
CREATE POLICY crawl_links_all ON crawl_links USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE audit_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_findings_all ON audit_findings USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE sitemap_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sitemap_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY sitemap_entries_all ON sitemap_entries USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE pagespeed_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagespeed_results FORCE ROW LEVEL SECURITY;
CREATE POLICY pagespeed_results_all ON pagespeed_results USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE keyword_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY keyword_groups_all ON keyword_groups USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords FORCE ROW LEVEL SECURITY;
CREATE POLICY keywords_all ON keywords USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE keyword_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY keyword_metrics_all ON keyword_metrics USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE keyword_research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_research_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY keyword_research_runs_all ON keyword_research_runs USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE serp_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE serp_results FORCE ROW LEVEL SECURITY;
CREATE POLICY serp_results_all ON serp_results USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE rank_check_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_check_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY rank_check_runs_all ON rank_check_runs USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE keyword_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_rankings FORCE ROW LEVEL SECURITY;
CREATE POLICY keyword_rankings_all ON keyword_rankings USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY competitor_snapshots_all ON competitor_snapshots USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE backlink_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE backlink_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY backlink_snapshots_all ON backlink_snapshots USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE backlinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE backlinks FORCE ROW LEVEL SECURITY;
CREATE POLICY backlinks_all ON backlinks USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE gsc_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY gsc_connections_all ON gsc_connections USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE gsc_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY gsc_metrics_all ON gsc_metrics USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE ga4_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY ga4_connections_all ON ga4_connections USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE ga4_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY ga4_metrics_all ON ga4_metrics USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items FORCE ROW LEVEL SECURITY;
CREATE POLICY content_items_all ON content_items USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE ai_visibility_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_prompts FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_visibility_prompts_all ON ai_visibility_prompts USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE ai_visibility_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_visibility_runs_all ON ai_visibility_runs USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE ai_visibility_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_results FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_visibility_results_all ON ai_visibility_results USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY reports_all ON reports USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY report_schedules_all ON report_schedules USING (app_can_access_project(project_id, organization_id)) WITH CHECK (app_can_access_project(project_id, organization_id));

-- Global reference tables: readable by everyone, writable only by system/admin paths.
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_select ON plans FOR SELECT USING (true);
CREATE POLICY plans_write ON plans USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices FORCE ROW LEVEL SECURITY;
CREATE POLICY prices_select ON prices FOR SELECT USING (true);
CREATE POLICY prices_write ON prices USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;
CREATE POLICY coupons_all ON coupons USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_events_all ON stripe_events USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_select ON feature_flags FOR SELECT USING (true);
CREATE POLICY feature_flags_write ON feature_flags USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE audit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_rules_select ON audit_rules FOR SELECT USING (true);
CREATE POLICY audit_rules_write ON audit_rules USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_health FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_health_select ON provider_health FOR SELECT USING (true);
CREATE POLICY provider_health_write ON provider_health USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());

-- permissions / role_permissions / rate_limit_counters / identity tables: no RLS (not tenant data).
