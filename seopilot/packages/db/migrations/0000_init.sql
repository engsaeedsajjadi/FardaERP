CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"active_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL
);

CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"marketing_consent_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_ids" jsonb,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text,
	"actor_user_id" text,
	"actor_api_key_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "feature_flag_overrides" (
	"flag_key" text NOT NULL,
	"organization_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_overrides_flag_key_organization_id_pk" PRIMARY KEY("flag_key","organization_id")
);

CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"enabled_globally" boolean DEFAULT false NOT NULL,
	"rollout_percent" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organization_invitations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"project_ids" jsonb,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organization_members" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"project_ids" jsonb,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "organizations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'standard' NOT NULL,
	"parent_organization_id" text,
	"owner_user_id" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"billing_email" text,
	"stripe_customer_id" text,
	"plan_code" text DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);

CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL
);

CREATE TABLE "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);

CREATE TABLE "role_permissions" (
	"role" text NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_key_pk" PRIMARY KEY("role","permission_key")
);

CREATE TABLE "white_label_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"company_name" text,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" text,
	"accent_color" text,
	"email_from_name" text,
	"email_from_address" text,
	"email_reply_to" text,
	"custom_domain" text,
	"custom_domain_verified_at" timestamp with time zone,
	"custom_domain_verification_token" text,
	"report_footer" text,
	"login_tagline" text,
	"hide_powered_by" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "competitors" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"discovered_via" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "project_integrations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_credentials" text,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "projects" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"site_url" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"search_engines" jsonb DEFAULT '["google"]'::jsonb NOT NULL,
	"devices" jsonb DEFAULT '["desktop","mobile"]'::jsonb NOT NULL,
	"location_code" integer,
	"brand_name" text,
	"brand_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"crawl_config" jsonb DEFAULT '{"maxPages":500,"maxDepth":10,"concurrency":4,"delayMs":250,"respectRobots":true,"renderJavaScript":false,"userAgent":null,"includePatterns":[],"excludePatterns":[],"followExternalLinksForStatus":true}'::jsonb NOT NULL,
	"domain_verification_token" text,
	"domain_verified_at" timestamp with time zone,
	"domain_verification_method" text,
	"created_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);

CREATE TABLE "websites" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"hostname" text NOT NULL,
	"url" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"robots_txt" text,
	"robots_fetched_at" timestamp with time zone,
	"sitemap_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"https_supported" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_findings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"crawl_run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"page_id" text,
	"page_url" text,
	"dedupe_key" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "audit_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"recommendation" text NOT NULL,
	"documentation_url" text,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "crawl_links" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"crawl_run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"source_page_id" text NOT NULL,
	"source_url" text NOT NULL,
	"target_url" text NOT NULL,
	"target_normalized_url" text NOT NULL,
	"anchor_text" text,
	"is_internal" boolean NOT NULL,
	"is_nofollow" boolean DEFAULT false NOT NULL,
	"rel" text,
	"target_status_code" integer
);

CREATE TABLE "crawl_pages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"crawl_run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"discovered_from" text,
	"discovery_source" text DEFAULT 'link' NOT NULL,
	"status_code" integer,
	"fetch_class" text NOT NULL,
	"content_type" text,
	"is_html" boolean DEFAULT false NOT NULL,
	"redirect_url" text,
	"redirect_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"response_time_ms" integer,
	"ttfb_ms" integer,
	"byte_length" integer,
	"content_encoding" text,
	"is_https" boolean DEFAULT false NOT NULL,
	"title" text,
	"meta_description" text,
	"canonical_url" text,
	"header_canonical_url" text,
	"robots_meta" text,
	"x_robots_tag" text,
	"is_indexable" boolean DEFAULT true NOT NULL,
	"is_nofollow" boolean DEFAULT false NOT NULL,
	"h1s" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"heading_outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"lang" text,
	"hreflang" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"og_title" text,
	"og_description" text,
	"og_image" text,
	"image_count" integer DEFAULT 0 NOT NULL,
	"images_missing_alt" integer DEFAULT 0 NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_link_count" integer DEFAULT 0 NOT NULL,
	"external_link_count" integer DEFAULT 0 NOT NULL,
	"inbound_link_count" integer DEFAULT 0 NOT NULL,
	"structured_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mixed_content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pagination_rel" jsonb,
	"in_sitemap" boolean DEFAULT false NOT NULL,
	"viewport_meta" boolean DEFAULT false NOT NULL,
	"rendered_with_js" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "crawl_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"start_url" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"pages_discovered" integer DEFAULT 0 NOT NULL,
	"pages_failed" integer DEFAULT 0 NOT NULL,
	"sitemap_url_count" integer DEFAULT 0 NOT NULL,
	"robots_txt_found" boolean,
	"robots_txt" text,
	"sitemap_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_reason" text,
	"error_message" text,
	"score_overall" integer,
	"score_breakdown" jsonb,
	"issue_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "pagespeed_results" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"strategy" text NOT NULL,
	"performance_score" integer,
	"accessibility_score" integer,
	"best_practices_score" integer,
	"seo_score" integer,
	"lcp_ms" integer,
	"cls_value" real,
	"inp_ms" integer,
	"ttfb_ms" integer,
	"fcp_ms" integer,
	"tbt_ms" integer,
	"speed_index_ms" integer,
	"field_lcp_ms" integer,
	"field_cls" real,
	"field_inp_ms" integer,
	"field_overall_category" text,
	"lighthouse_version" text,
	"raw_storage_key" text,
	"error_message" text,
	"provider" text DEFAULT 'google_pagespeed' NOT NULL,
	"provider_request_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sitemap_entries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"crawl_run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"sitemap_url" text NOT NULL,
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"lastmod" timestamp with time zone,
	"changefreq" text,
	"priority" real,
	"crawled" boolean DEFAULT false NOT NULL,
	"status_code" integer
);

CREATE TABLE "backlink_snapshots" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"target" text NOT NULL,
	"backlinks" integer,
	"referring_domains" integer,
	"referring_ips" integer,
	"dofollow" integer,
	"nofollow" integer,
	"domain_rank" integer,
	"broken_backlinks" integer,
	"new_last_30" integer,
	"lost_last_30" integer,
	"anchors" jsonb,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "backlinks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"target" text NOT NULL,
	"source_url" text NOT NULL,
	"source_domain" text NOT NULL,
	"target_url" text NOT NULL,
	"anchor" text,
	"is_dofollow" boolean DEFAULT true NOT NULL,
	"link_type" text,
	"domain_rank" integer,
	"page_rank" integer,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"is_lost" boolean DEFAULT false NOT NULL,
	"lost_at" timestamp with time zone,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "competitor_snapshots" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"competitor_id" text,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"organic_keywords" integer,
	"organic_traffic" real,
	"organic_traffic_cost" real,
	"top_pages" jsonb,
	"ranked_keywords" jsonb,
	"referring_domains" integer,
	"backlinks" integer,
	"domain_rank" integer,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "keyword_groups" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"cluster_method" text,
	"cluster_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "keyword_metrics" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"keyword_id" text,
	"keyword" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"search_volume" integer,
	"cpc" real,
	"competition" real,
	"competition_level" text,
	"keyword_difficulty" integer,
	"intent" text,
	"serp_features" jsonb,
	"monthly_searches" jsonb,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "keyword_rankings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"keyword_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"rank_check_run_id" text,
	"serp_result_id" text,
	"checked_on" date NOT NULL,
	"position" integer,
	"previous_position" integer,
	"url" text,
	"search_engine" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"device" text NOT NULL,
	"serp_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competing_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"top_competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "keyword_research_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"input" jsonb NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "keywords" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" text,
	"keyword" text NOT NULL,
	"normalized_keyword" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"location_code" integer,
	"device" text DEFAULT 'desktop' NOT NULL,
	"search_engine" text DEFAULT 'google' NOT NULL,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"target_url" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intent" text,
	"intent_source" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "rank_check_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"keyword_count" integer DEFAULT 0 NOT NULL,
	"checked_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "serp_results" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"keyword_id" text,
	"query" text NOT NULL,
	"search_engine" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"location_code" integer,
	"device" text NOT NULL,
	"result_count" integer,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"serp_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"check_url" text,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ga4_connections" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"google_account_email" text,
	"property_id" text NOT NULL,
	"property_name" text,
	"encrypted_refresh_token" text NOT NULL,
	"encrypted_access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"connected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ga4_metrics" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"date" date NOT NULL,
	"dimension" text NOT NULL,
	"dimension_value" text,
	"channel_group" text,
	"users" integer DEFAULT 0 NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"conversions" real DEFAULT 0 NOT NULL,
	"revenue" real,
	"bounce_rate" real,
	"avg_session_duration_sec" real,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "gsc_connections" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"google_account_email" text,
	"site_url" text NOT NULL,
	"permission_level" text,
	"encrypted_refresh_token" text NOT NULL,
	"encrypted_access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"connected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "gsc_metrics" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"date" date NOT NULL,
	"dimension" text NOT NULL,
	"query" text,
	"page" text,
	"country" text,
	"device" text,
	"search_appearance" text,
	"search_type" text DEFAULT 'web' NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" real NOT NULL,
	"position" real NOT NULL,
	"key_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"user_id" text,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" real,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"provider_request_id" text,
	"status" text NOT NULL,
	"error_message" text,
	"prompt_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_visibility_prompts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"prompt" text NOT NULL,
	"topic" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_visibility_results" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"run_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"brand_mentioned" boolean NOT NULL,
	"brand_mention_count" integer DEFAULT 0 NOT NULL,
	"competitor_mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_cited" boolean DEFAULT false NOT NULL,
	"sentiment" text,
	"sentiment_source" text,
	"ai_run_id" text,
	"provider_request_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ai_visibility_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "content_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"target_url" text,
	"target_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_run_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "coupons" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"code" text NOT NULL,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"percent_off" real,
	"amount_off" integer,
	"currency" text,
	"duration" text,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"wallet_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"operation" text,
	"provider" text,
	"quantity" integer,
	"provider_cost_usd" real,
	"reference_type" text,
	"reference_id" text,
	"idempotency_key" text,
	"note" text,
	"actor_user_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "credit_wallets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"low_balance_threshold" integer DEFAULT 100 NOT NULL,
	"low_balance_notified_at" timestamp with time zone,
	"monthly_ai_cap" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "invoices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"subscription_id" text,
	"stripe_invoice_id" text NOT NULL,
	"number" text,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"amount_due" integer NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"due_date" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "payments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_id" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"limits" jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "prices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"plan_code" text NOT NULL,
	"stripe_price_id" text,
	"currency" text DEFAULT 'usd' NOT NULL,
	"unit_amount" integer NOT NULL,
	"interval" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"api_version" text,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"price_id" text,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"seats" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"metric" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "job_attempts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"job_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"worker_id" text,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);

CREATE TABLE "jobs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"idempotency_key" text,
	"boss_job_id" text,
	"schedule_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"requested_by" text,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notification_rules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"event" text NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" jsonb DEFAULT '[{"type":"dashboard"}]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"user_id" text,
	"rule_id" text,
	"event" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"deliveries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "schedules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"job_type" text NOT NULL,
	"name" text NOT NULL,
	"frequency" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_job_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"webhook_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_status" integer,
	"response_body_snippet" text,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"url" text NOT NULL,
	"description" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_secret" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"last_delivered_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "data_exports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text,
	"user_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"expires_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "provider_health" (
	"provider" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "report_schedules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"schedule_id" text NOT NULL,
	"type" text NOT NULL,
	"format" text DEFAULT 'pdf' NOT NULL,
	"recipient_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"include_share_link" boolean DEFAULT true NOT NULL,
	"share_link_ttl_days" integer DEFAULT 30 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "report_shares" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"report_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"password_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"max_views" integer,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "reports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"schedule_id" text,
	"type" text NOT NULL,
	"format" text NOT NULL,
	"title" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"size_bytes" integer,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"branding_snapshot" jsonb,
	"error_message" text,
	"generated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_organization_id_organizations_id_fk" FOREIGN KEY ("parent_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "white_label_settings" ADD CONSTRAINT "white_label_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "websites" ADD CONSTRAINT "websites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "websites" ADD CONSTRAINT "websites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_rule_id_audit_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."audit_rules"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_page_id_crawl_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."crawl_pages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "crawl_links" ADD CONSTRAINT "crawl_links_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_links" ADD CONSTRAINT "crawl_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_links" ADD CONSTRAINT "crawl_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_links" ADD CONSTRAINT "crawl_links_source_page_id_crawl_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."crawl_pages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "pagespeed_results" ADD CONSTRAINT "pagespeed_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "pagespeed_results" ADD CONSTRAINT "pagespeed_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "backlink_snapshots" ADD CONSTRAINT "backlink_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "backlink_snapshots" ADD CONSTRAINT "backlink_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "backlinks" ADD CONSTRAINT "backlinks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_groups" ADD CONSTRAINT "keyword_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_groups" ADD CONSTRAINT "keyword_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_metrics" ADD CONSTRAINT "keyword_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_metrics" ADD CONSTRAINT "keyword_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_metrics" ADD CONSTRAINT "keyword_metrics_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_rank_check_run_id_rank_check_runs_id_fk" FOREIGN KEY ("rank_check_run_id") REFERENCES "public"."rank_check_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_serp_result_id_serp_results_id_fk" FOREIGN KEY ("serp_result_id") REFERENCES "public"."serp_results"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "keyword_research_runs" ADD CONSTRAINT "keyword_research_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_research_runs" ADD CONSTRAINT "keyword_research_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keyword_research_runs" ADD CONSTRAINT "keyword_research_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_group_id_keyword_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."keyword_groups"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "rank_check_runs" ADD CONSTRAINT "rank_check_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "rank_check_runs" ADD CONSTRAINT "rank_check_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "rank_check_runs" ADD CONSTRAINT "rank_check_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "serp_results" ADD CONSTRAINT "serp_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "serp_results" ADD CONSTRAINT "serp_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "serp_results" ADD CONSTRAINT "serp_results_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ga4_connections" ADD CONSTRAINT "ga4_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ga4_connections" ADD CONSTRAINT "ga4_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ga4_connections" ADD CONSTRAINT "ga4_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "ga4_metrics" ADD CONSTRAINT "ga4_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ga4_metrics" ADD CONSTRAINT "ga4_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ga4_metrics" ADD CONSTRAINT "ga4_metrics_connection_id_ga4_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ga4_connections"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "gsc_metrics" ADD CONSTRAINT "gsc_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "gsc_metrics" ADD CONSTRAINT "gsc_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "gsc_metrics" ADD CONSTRAINT "gsc_metrics_connection_id_gsc_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."gsc_connections"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_prompts" ADD CONSTRAINT "ai_visibility_prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_prompts" ADD CONSTRAINT "ai_visibility_prompts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_prompts" ADD CONSTRAINT "ai_visibility_prompts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "ai_visibility_results" ADD CONSTRAINT "ai_visibility_results_run_id_ai_visibility_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_visibility_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_results" ADD CONSTRAINT "ai_visibility_results_prompt_id_ai_visibility_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_visibility_prompts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_results" ADD CONSTRAINT "ai_visibility_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_results" ADD CONSTRAINT "ai_visibility_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_results" ADD CONSTRAINT "ai_visibility_results_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "ai_visibility_runs" ADD CONSTRAINT "ai_visibility_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_runs" ADD CONSTRAINT "ai_visibility_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_visibility_runs" ADD CONSTRAINT "ai_visibility_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_wallet_id_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "prices" ADD CONSTRAINT "prices_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_id_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."prices"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rule_id_notification_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_rules"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reports" ADD CONSTRAINT "reports_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "reports" ADD CONSTRAINT "reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");
CREATE UNIQUE INDEX "accounts_provider_uq" ON "accounts" USING btree ("provider_id","account_id");
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token");
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
CREATE INDEX "two_factors_user_idx" ON "two_factors" USING btree ("user_id");
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");
CREATE INDEX "organization_invitations_org_idx" ON "organization_invitations" USING btree ("organization_id");
CREATE UNIQUE INDEX "organization_invitations_token_uq" ON "organization_invitations" USING btree ("token_hash");
CREATE UNIQUE INDEX "organization_members_org_user_uq" ON "organization_members" USING btree ("organization_id","user_id");
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");
CREATE INDEX "organizations_parent_idx" ON "organizations" USING btree ("parent_organization_id");
CREATE UNIQUE INDEX "organizations_stripe_customer_uq" ON "organizations" USING btree ("stripe_customer_id");
CREATE UNIQUE INDEX "white_label_custom_domain_uq" ON "white_label_settings" USING btree ("custom_domain");
CREATE INDEX "competitors_project_idx" ON "competitors" USING btree ("project_id");
CREATE UNIQUE INDEX "competitors_project_domain_uq" ON "competitors" USING btree ("project_id","domain");
CREATE UNIQUE INDEX "project_integrations_project_kind_uq" ON "project_integrations" USING btree ("project_id","kind");
CREATE INDEX "project_integrations_org_idx" ON "project_integrations" USING btree ("organization_id");
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("organization_id");
CREATE UNIQUE INDEX "projects_org_domain_uq" ON "projects" USING btree ("organization_id","domain");
CREATE INDEX "websites_project_idx" ON "websites" USING btree ("project_id");
CREATE UNIQUE INDEX "websites_project_host_uq" ON "websites" USING btree ("project_id","hostname");
CREATE UNIQUE INDEX "audit_findings_dedupe_uq" ON "audit_findings" USING btree ("crawl_run_id","rule_id","dedupe_key");
CREATE INDEX "audit_findings_run_rule_idx" ON "audit_findings" USING btree ("crawl_run_id","rule_id");
CREATE INDEX "audit_findings_project_idx" ON "audit_findings" USING btree ("project_id");
CREATE INDEX "audit_findings_run_severity_idx" ON "audit_findings" USING btree ("crawl_run_id","severity");
CREATE INDEX "crawl_links_run_target_idx" ON "crawl_links" USING btree ("crawl_run_id","target_normalized_url");
CREATE INDEX "crawl_links_run_source_idx" ON "crawl_links" USING btree ("crawl_run_id","source_page_id");
CREATE UNIQUE INDEX "crawl_pages_run_url_uq" ON "crawl_pages" USING btree ("crawl_run_id","normalized_url");
CREATE INDEX "crawl_pages_project_idx" ON "crawl_pages" USING btree ("project_id");
CREATE INDEX "crawl_pages_run_status_idx" ON "crawl_pages" USING btree ("crawl_run_id","status_code");
CREATE INDEX "crawl_pages_run_hash_idx" ON "crawl_pages" USING btree ("crawl_run_id","content_hash");
CREATE INDEX "crawl_runs_project_created_idx" ON "crawl_runs" USING btree ("project_id","created_at");
CREATE INDEX "crawl_runs_org_idx" ON "crawl_runs" USING btree ("organization_id");
CREATE INDEX "crawl_runs_status_idx" ON "crawl_runs" USING btree ("status");
CREATE INDEX "pagespeed_project_url_idx" ON "pagespeed_results" USING btree ("project_id","url","fetched_at");
CREATE UNIQUE INDEX "sitemap_entries_run_url_uq" ON "sitemap_entries" USING btree ("crawl_run_id","normalized_url");
CREATE INDEX "sitemap_entries_project_idx" ON "sitemap_entries" USING btree ("project_id");
CREATE INDEX "backlink_snapshots_project_idx" ON "backlink_snapshots" USING btree ("project_id","fetched_at");
CREATE UNIQUE INDEX "backlinks_project_src_tgt_uq" ON "backlinks" USING btree ("project_id","source_url","target_url");
CREATE INDEX "backlinks_project_domain_idx" ON "backlinks" USING btree ("project_id","source_domain");
CREATE INDEX "backlinks_project_lost_idx" ON "backlinks" USING btree ("project_id","is_lost");
CREATE INDEX "competitor_snapshots_project_domain_idx" ON "competitor_snapshots" USING btree ("project_id","domain","fetched_at");
CREATE UNIQUE INDEX "keyword_groups_project_name_uq" ON "keyword_groups" USING btree ("project_id","name");
CREATE INDEX "keyword_metrics_lookup_idx" ON "keyword_metrics" USING btree ("organization_id","keyword","country","language","fetched_at");
CREATE INDEX "keyword_metrics_keyword_id_idx" ON "keyword_metrics" USING btree ("keyword_id");
CREATE UNIQUE INDEX "keyword_rankings_keyword_day_uq" ON "keyword_rankings" USING btree ("keyword_id","checked_on");
CREATE INDEX "keyword_rankings_project_day_idx" ON "keyword_rankings" USING btree ("project_id","checked_on");
CREATE INDEX "keyword_research_project_idx" ON "keyword_research_runs" USING btree ("project_id","created_at");
CREATE UNIQUE INDEX "keywords_project_kw_ctx_uq" ON "keywords" USING btree ("project_id","normalized_keyword","country","language","device","search_engine");
CREATE INDEX "keywords_project_tracked_idx" ON "keywords" USING btree ("project_id","is_tracked");
CREATE INDEX "keywords_org_idx" ON "keywords" USING btree ("organization_id");
CREATE INDEX "rank_check_runs_project_idx" ON "rank_check_runs" USING btree ("project_id","created_at");
CREATE INDEX "serp_results_keyword_fetched_idx" ON "serp_results" USING btree ("keyword_id","fetched_at");
CREATE INDEX "serp_results_project_idx" ON "serp_results" USING btree ("project_id","fetched_at");
CREATE UNIQUE INDEX "ga4_connections_project_uq" ON "ga4_connections" USING btree ("project_id");
CREATE UNIQUE INDEX "ga4_metrics_key_uq" ON "ga4_metrics" USING btree ("project_id","date","dimension","dimension_value","channel_group");
CREATE INDEX "ga4_metrics_project_date_idx" ON "ga4_metrics" USING btree ("project_id","dimension","date");
CREATE UNIQUE INDEX "gsc_connections_project_uq" ON "gsc_connections" USING btree ("project_id");
CREATE UNIQUE INDEX "gsc_metrics_key_uq" ON "gsc_metrics" USING btree ("project_id","date","dimension","key_hash");
CREATE INDEX "gsc_metrics_project_date_dim_idx" ON "gsc_metrics" USING btree ("project_id","dimension","date");
CREATE INDEX "gsc_metrics_project_query_idx" ON "gsc_metrics" USING btree ("project_id","query");
CREATE INDEX "gsc_metrics_project_page_idx" ON "gsc_metrics" USING btree ("project_id","page");
CREATE INDEX "ai_runs_org_created_idx" ON "ai_runs" USING btree ("organization_id","created_at");
CREATE INDEX "ai_runs_project_idx" ON "ai_runs" USING btree ("project_id");
CREATE INDEX "ai_visibility_prompts_project_idx" ON "ai_visibility_prompts" USING btree ("project_id");
CREATE INDEX "ai_visibility_results_run_idx" ON "ai_visibility_results" USING btree ("run_id");
CREATE INDEX "ai_visibility_results_project_idx" ON "ai_visibility_results" USING btree ("project_id","fetched_at");
CREATE INDEX "ai_visibility_runs_project_idx" ON "ai_visibility_runs" USING btree ("project_id","created_at");
CREATE INDEX "content_items_project_idx" ON "content_items" USING btree ("project_id","created_at");
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("code");
CREATE INDEX "credit_transactions_wallet_created_idx" ON "credit_transactions" USING btree ("wallet_id","created_at");
CREATE INDEX "credit_transactions_org_created_idx" ON "credit_transactions" USING btree ("organization_id","created_at");
CREATE UNIQUE INDEX "credit_transactions_idem_uq" ON "credit_transactions" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "credit_wallets_org_uq" ON "credit_wallets" USING btree ("organization_id");
CREATE UNIQUE INDEX "invoices_stripe_uq" ON "invoices" USING btree ("stripe_invoice_id");
CREATE INDEX "invoices_org_idx" ON "invoices" USING btree ("organization_id","created_at");
CREATE UNIQUE INDEX "payments_pi_uq" ON "payments" USING btree ("stripe_payment_intent_id");
CREATE INDEX "payments_org_idx" ON "payments" USING btree ("organization_id");
CREATE UNIQUE INDEX "prices_stripe_uq" ON "prices" USING btree ("stripe_price_id");
CREATE INDEX "prices_plan_idx" ON "prices" USING btree ("plan_code");
CREATE INDEX "stripe_events_type_idx" ON "stripe_events" USING btree ("type","created_at");
CREATE INDEX "subscriptions_org_idx" ON "subscriptions" USING btree ("organization_id");
CREATE UNIQUE INDEX "subscriptions_stripe_uq" ON "subscriptions" USING btree ("stripe_subscription_id");
CREATE UNIQUE INDEX "usage_records_bucket_uq" ON "usage_records" USING btree ("organization_id","project_id","metric","period_start","provider");
CREATE INDEX "usage_records_org_metric_period_idx" ON "usage_records" USING btree ("organization_id","metric","period_start");
CREATE INDEX "job_attempts_job_idx" ON "job_attempts" USING btree ("job_id");
CREATE INDEX "jobs_org_created_idx" ON "jobs" USING btree ("organization_id","created_at");
CREATE INDEX "jobs_project_type_idx" ON "jobs" USING btree ("project_id","type");
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");
CREATE UNIQUE INDEX "jobs_idem_uq" ON "jobs" USING btree ("idempotency_key");
CREATE INDEX "notification_rules_org_event_idx" ON "notification_rules" USING btree ("organization_id","event");
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("organization_id","created_at");
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");
CREATE INDEX "schedules_next_run_idx" ON "schedules" USING btree ("is_enabled","next_run_at");
CREATE INDEX "schedules_project_idx" ON "schedules" USING btree ("project_id");
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");
CREATE INDEX "webhooks_org_idx" ON "webhooks" USING btree ("organization_id");
CREATE INDEX "data_exports_user_idx" ON "data_exports" USING btree ("user_id");
CREATE INDEX "report_schedules_project_idx" ON "report_schedules" USING btree ("project_id");
CREATE UNIQUE INDEX "report_shares_token_uq" ON "report_shares" USING btree ("token_hash");
CREATE INDEX "report_shares_report_idx" ON "report_shares" USING btree ("report_id");
CREATE INDEX "reports_project_created_idx" ON "reports" USING btree ("project_id","created_at");
CREATE INDEX "reports_org_idx" ON "reports" USING btree ("organization_id");