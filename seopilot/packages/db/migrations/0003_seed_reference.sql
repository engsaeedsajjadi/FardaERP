-- Reference data: plans (spec §37), permissions catalogue (spec §8), audit rule
-- rows are synced by the audit package at worker boot, feature flags (spec §53).
-- Limits live here, centrally, and are read by @seopilot/billing plan-limits.ts.

INSERT INTO plans (code, name, description, limits, features, trial_days, sort_order, is_public, is_active) VALUES
('free', 'Free', 'Evaluate SEOPilot on one small site.',
 '{"projects":1,"keywords":25,"crawledPagesPerMonth":500,"rankChecksPerMonth":750,"aiOperationsPerMonth":20,"reportsPerMonth":3,"users":1,"apiRequestsPerDay":200,"competitorsPerProject":2,"clientOrganizations":0,"whiteLabel":false,"agencyMode":false,"monthlyCredits":200}',
 '["site_audit","rank_tracking","keyword_research","gsc","pagespeed"]', 0, 0, true, true),
('starter', 'Starter', 'For freelancers and small businesses.',
 '{"projects":3,"keywords":250,"crawledPagesPerMonth":10000,"rankChecksPerMonth":7500,"aiOperationsPerMonth":200,"reportsPerMonth":20,"users":3,"apiRequestsPerDay":2000,"competitorsPerProject":5,"clientOrganizations":0,"whiteLabel":false,"agencyMode":false,"monthlyCredits":2000}',
 '["site_audit","rank_tracking","keyword_research","gsc","ga4","pagespeed","backlinks","competitors","content","alerts","reports"]', 14, 1, true, true),
('pro', 'Pro', 'For in-house SEO teams.',
 '{"projects":10,"keywords":1500,"crawledPagesPerMonth":100000,"rankChecksPerMonth":45000,"aiOperationsPerMonth":1500,"reportsPerMonth":100,"users":10,"apiRequestsPerDay":20000,"competitorsPerProject":10,"clientOrganizations":0,"whiteLabel":false,"agencyMode":false,"monthlyCredits":10000}',
 '["site_audit","rank_tracking","keyword_research","gsc","ga4","pagespeed","backlinks","competitors","content","alerts","reports","geo","aeo","api","webhooks","mcp","js_rendering"]', 14, 2, true, true),
('agency', 'Agency', 'Manage many clients with white-label reporting.',
 '{"projects":50,"keywords":10000,"crawledPagesPerMonth":500000,"rankChecksPerMonth":300000,"aiOperationsPerMonth":6000,"reportsPerMonth":1000,"users":50,"apiRequestsPerDay":100000,"competitorsPerProject":20,"clientOrganizations":50,"whiteLabel":true,"agencyMode":true,"monthlyCredits":40000}',
 '["site_audit","rank_tracking","keyword_research","gsc","ga4","pagespeed","backlinks","competitors","content","alerts","reports","geo","aeo","api","webhooks","mcp","js_rendering","agency","white_label","client_portal","scheduled_reports"]', 14, 3, true, true),
('enterprise', 'Enterprise', 'Custom limits, SSO and dedicated support.',
 '{"projects":1000,"keywords":250000,"crawledPagesPerMonth":10000000,"rankChecksPerMonth":7500000,"aiOperationsPerMonth":100000,"reportsPerMonth":100000,"users":1000,"apiRequestsPerDay":2000000,"competitorsPerProject":50,"clientOrganizations":1000,"whiteLabel":true,"agencyMode":true,"monthlyCredits":500000}',
 '["site_audit","rank_tracking","keyword_research","gsc","ga4","pagespeed","backlinks","competitors","content","alerts","reports","geo","aeo","api","webhooks","mcp","js_rendering","agency","white_label","client_portal","scheduled_reports","sso","audit_log_export"]', 0, 4, false, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (key, category, description) VALUES
('org.read','organization','View organization settings'),
('org.manage','organization','Change organization settings, white-label, delete organization'),
('team.read','team','View members'),
('team.invite','team','Invite members and change roles'),
('team.remove','team','Remove members'),
('project.read','project','View projects'),
('project.write','project','Create and edit projects'),
('project.delete','project','Delete projects'),
('seo.audit.run','audit','Start site crawls and audits'),
('seo.audit.read','audit','View audit results'),
('keyword.read','keywords','View keywords and research'),
('keyword.write','keywords','Add, edit, delete keywords and run research'),
('rank.read','rankings','View rankings'),
('rank.run','rankings','Trigger rank checks'),
('competitor.read','competitors','View competitors'),
('competitor.write','competitors','Manage competitors'),
('backlink.read','backlinks','View backlinks'),
('backlink.run','backlinks','Refresh backlink data'),
('integration.read','integrations','View integration status'),
('integration.manage','integrations','Connect and disconnect GSC/GA4/Slack etc.'),
('content.read','content','View content items'),
('content.write','content','Generate and edit content'),
('ai.run','ai','Run AI operations (content, GEO, AEO)'),
('reports.read','reports','View and download reports'),
('reports.generate','reports','Generate and schedule reports, create share links'),
('automation.read','automation','View schedules and jobs'),
('automation.manage','automation','Create and edit schedules and alert rules'),
('billing.read','billing','View plan, invoices, usage and credits'),
('billing.manage','billing','Change plan, payment method, buy credits'),
('api.manage','api','Create and revoke API keys and webhooks'),
('agency.manage','agency','Create and manage client organizations'),
('audit_log.read','security','View the organization audit log')
ON CONFLICT (key) DO NOTHING;

-- Role matrix (spec §8). owner gets everything.
INSERT INTO role_permissions (role, permission_key) SELECT 'owner', key FROM permissions ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission_key) SELECT 'admin', key FROM permissions WHERE key <> 'org.manage' OR key = 'org.manage' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission_key) SELECT 'manager', key FROM permissions
  WHERE key NOT IN ('org.manage','billing.manage','api.manage','team.remove','project.delete') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission_key) SELECT 'seo_manager', key FROM permissions
  WHERE key IN ('org.read','team.read','project.read','project.write','seo.audit.run','seo.audit.read','keyword.read','keyword.write','rank.read','rank.run',
   'competitor.read','competitor.write','backlink.read','backlink.run','integration.read','integration.manage','content.read','content.write','ai.run',
   'reports.read','reports.generate','automation.read','automation.manage','billing.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission_key) SELECT 'analyst', key FROM permissions
  WHERE key IN ('org.read','team.read','project.read','seo.audit.read','seo.audit.run','keyword.read','keyword.write','rank.read','rank.run','competitor.read',
   'backlink.read','integration.read','content.read','reports.read','reports.generate','automation.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission_key) SELECT 'editor', key FROM permissions
  WHERE key IN ('org.read','project.read','seo.audit.read','keyword.read','rank.read','content.read','content.write','ai.run','reports.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission_key) SELECT 'client', key FROM permissions
  WHERE key IN ('project.read','seo.audit.read','keyword.read','rank.read','competitor.read','backlink.read','content.read','reports.read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, permission_key) SELECT 'viewer', key FROM permissions
  WHERE key IN ('org.read','team.read','project.read','seo.audit.read','keyword.read','rank.read','competitor.read','backlink.read','integration.read','content.read','reports.read','automation.read','billing.read') ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (key, description, enabled_globally, rollout_percent) VALUES
('ai', 'AI-assisted content features', true, 100),
('geo', 'Generative Engine Optimization (AI visibility)', true, 100),
('aeo', 'Answer Engine Optimization analysis', true, 100),
('advanced_crawling', 'JavaScript rendering with Playwright', false, 0),
('beta_providers', 'Non-default SERP/keyword providers', false, 0),
('experimental', 'Experimental features', false, 0)
ON CONFLICT (key) DO NOTHING;
