-- Schema extracted exclusively from live production catalogs; no table rows.

-- Supabase platform schemas/roles are supplied by the pinned local stack.

-- This baseline is for EMPTY installations. Production adoption is separate.

SET search_path = public, extensions;

SET check_function_bodies = false;

DO $empty$ BEGIN IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')) THEN RAISE EXCEPTION 'baseline_requires_empty_application_schema'; END IF; END $empty$;

CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE SCHEMA IF NOT EXISTS "vault";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE TYPE "public"."application_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE "public"."punishment_type" AS ENUM ('warning', 'mute', 'temp_ban', 'perm_ban');

CREATE TABLE "public"."account_verification_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "linkedin_url" text NOT NULL,
  "portfolio_links" text[] NOT NULL,
  "work_sample_urls" text[] DEFAULT '{}'::text[] NOT NULL,
  "email_verified_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "rejection_reason" text,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "work_sample_keys" text[] DEFAULT '{}'::text[] NOT NULL
);

CREATE TABLE "public"."application_tags" (
  "application_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL
);

CREATE TABLE "public"."applications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "linkedin_url" text NOT NULL,
  "portfolio_url" text NOT NULL,
  "status" application_status DEFAULT 'pending'::application_status NOT NULL,
  "review_notes" text,
  "applicant_email" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."auth_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "role" text NOT NULL,
  "session_version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text,
  "user_agent" text
);

CREATE TABLE "public"."cities" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "image_url" text,
  "lottie_url" text,
  "lottie_format" text
);

CREATE TABLE "public"."communities" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "type" text NOT NULL,
  "reference_id" uuid,
  "image_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "owner_id" uuid,
  "is_private" boolean DEFAULT false NOT NULL,
  "invite_token" text DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text) NOT NULL,
  "enabled_tabs" text[] DEFAULT ARRAY['chat'::text, 'threads'::text, 'events'::text, 'resources'::text] NOT NULL,
  "member_count" bigint DEFAULT 0 NOT NULL,
  "lottie_url" text,
  "lottie_format" text,
  "showcase_enabled" boolean DEFAULT true NOT NULL,
  "event_id" uuid
);

CREATE TABLE "public"."community_admin_activity" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "actor_id" uuid,
  "actor_role" text DEFAULT 'admin'::text NOT NULL,
  "actor_name" text,
  "action" text NOT NULL,
  "target_user_id" uuid,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."community_admin_permissions" (
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "can_edit_settings" boolean DEFAULT true NOT NULL,
  "can_manage_members" boolean DEFAULT true NOT NULL,
  "can_delete_messages" boolean DEFAULT true NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "granted_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "can_moderate_threads" boolean DEFAULT true NOT NULL,
  "can_moderate_showcase" boolean DEFAULT true NOT NULL,
  "can_moderate_resources" boolean DEFAULT true NOT NULL,
  "can_moderate_events" boolean DEFAULT true NOT NULL
);

CREATE TABLE "public"."community_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" character varying(120) NOT NULL,
  "description" text,
  "event_date" timestamp with time zone NOT NULL,
  "end_date" timestamp with time zone,
  "is_online" boolean DEFAULT false NOT NULL,
  "location" text,
  "meet_link" text,
  "max_attendees" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cover_image_url" text,
  "is_public" boolean DEFAULT false NOT NULL,
  "accent_color" text,
  "host_timezone" text,
  "host_utc_offset_minutes" integer
);

CREATE TABLE "public"."community_join_requests" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  "decided_by" uuid,
  "request_message" text
);

CREATE TABLE "public"."community_members" (
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_read_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "history_cleared_at" timestamp with time zone,
  "role" text DEFAULT 'member'::text NOT NULL,
  "notifications_muted" boolean DEFAULT false NOT NULL,
  "notifications_muted_until" timestamp with time zone
);

CREATE TABLE "public"."community_messages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "content" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reply_to_id" uuid,
  "image_url" text,
  "moderation_log_id" uuid,
  "deleted_at" timestamp with time zone,
  "image_status" text,
  "image_moderated_at" timestamp with time zone,
  "image_moderation_error" text,
  "edited_at" timestamp with time zone,
  "mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reply_to_content_id" uuid,
  "deleted_by" uuid,
  "deleted_by_role" text
);

CREATE TABLE "public"."community_resources" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" character varying(120) NOT NULL,
  "description" text,
  "resource_type" text NOT NULL,
  "url" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "allow_replies" boolean DEFAULT true NOT NULL
);

CREATE TABLE "public"."community_rules" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "rule_text" text NOT NULL,
  "order_index" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."community_showcase_posts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "image_url" text NOT NULL,
  "category" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "allow_replies" boolean DEFAULT true NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE "public"."community_threads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" character varying(2000) NOT NULL,
  "category" text NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "links" text[] DEFAULT '{}'::text[] NOT NULL,
  "allow_replies" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "poll" jsonb
);

CREATE TABLE "public"."companies" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo_url" text,
  "created_by" uuid,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "country_code" text,
  "industry" text,
  "entity_status" text DEFAULT 'unknown'::text NOT NULL,
  "source" text,
  "source_id" text,
  "jurisdiction" text,
  "source_confidence" text,
  "directory_rank" integer,
  "last_checked_at" timestamp with time zone,
  "featured_rank" integer
);

CREATE TABLE "public"."company_aliases" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "alias" text NOT NULL,
  "alias_type" text DEFAULT 'alias'::text NOT NULL,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."company_directory_seed_retired" (
  "name" text NOT NULL,
  "domain" text NOT NULL,
  "slug" text NOT NULL,
  "retired_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."company_domain_delegations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "domain" text NOT NULL,
  "granted_by" uuid NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "review_status" text DEFAULT 'unreviewed'::text NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."company_domain_reviews" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "domain" text NOT NULL,
  "company_id" uuid NOT NULL,
  "evidence_id" uuid,
  "reviewer_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "before_confidence" text,
  "after_confidence" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."company_domains" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "domain" text NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "domain_type" text DEFAULT 'primary_website'::text NOT NULL,
  "evidence_confidence" text DEFAULT 'unknown'::text NOT NULL,
  "source" text,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_checked_at" timestamp with time zone
);

CREATE TABLE "public"."company_email_verifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "company_id" uuid,
  "company_name" text NOT NULL,
  "domain" text NOT NULL,
  "work_email" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "domain_owner_company_id" uuid,
  "via_delegation" boolean DEFAULT false NOT NULL,
  "contested" boolean DEFAULT false NOT NULL
);

CREATE TABLE "public"."company_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."company_relationships" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "parent_company_id" uuid NOT NULL,
  "child_company_id" uuid NOT NULL,
  "relationship_type" text NOT NULL,
  "source" text,
  "source_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."content_reactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "content_id" uuid NOT NULL,
  "content_kind" text NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."content_removals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "content_type" text NOT NULL,
  "content_id" uuid NOT NULL,
  "community_id" uuid,
  "content_author_id" uuid,
  "content_title" text,
  "snapshot" jsonb NOT NULL,
  "removed_by" uuid,
  "removed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "undone_at" timestamp with time zone,
  "undone_by" uuid
);

CREATE TABLE "public"."content_reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "reporter_id" uuid,
  "content_type" text NOT NULL,
  "content_id" uuid NOT NULL,
  "community_id" uuid,
  "content_author_id" uuid,
  "content_title" text,
  "reason" text NOT NULL,
  "details" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reporter_deleted_at" timestamp with time zone,
  "target_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE "public"."creation_limits" (
  "kind" text NOT NULL,
  "limit_count" integer NOT NULL,
  "period" text NOT NULL
);

CREATE TABLE "public"."design_sectors" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "image_url" text,
  "lottie_url" text,
  "lottie_format" text
);

CREATE TABLE "public"."designer_profiles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "city_id" uuid,
  "sector_id" uuid,
  "experience_level" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "avatar_url" text,
  "avatar_source" text,
  "linkedin_url" text,
  "portfolio_url" text,
  "bio" text,
  "communities_auto_joined" boolean DEFAULT false NOT NULL,
  "job_title" text,
  "company_id" uuid
);

CREATE TABLE "public"."dm_conversations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_a" uuid NOT NULL,
  "user_b" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_at" timestamp with time zone,
  "user_a_last_read_at" timestamp with time zone,
  "user_b_last_read_at" timestamp with time zone,
  "request_state" text DEFAULT 'accepted'::text NOT NULL,
  "requested_by" uuid
);

CREATE TABLE "public"."dm_message_reactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."dm_messages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "content" text,
  "image_url" text,
  "reply_to_id" uuid,
  "edited_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "client_nonce" uuid,
  "image_key" text
);

CREATE TABLE "public"."dm_reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "reporter_id" uuid,
  "reported_user_id" uuid,
  "conversation_id" uuid,
  "reason" text NOT NULL,
  "details" text,
  "message_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reporter_deleted_at" timestamp with time zone
);

CREATE TABLE "public"."domain_evidence" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "domain" text NOT NULL,
  "evidence_type" text NOT NULL,
  "source_url" text,
  "source" text,
  "checked" boolean DEFAULT false NOT NULL,
  "observed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."event_chat_join_responses" (
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "why_attend" text NOT NULL,
  "expectations" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."event_comment_reactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."event_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "image_url" text,
  "parent_id" uuid
);

CREATE TABLE "public"."event_likes" (
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."event_notification_deliveries" (
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "stage" text NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."event_rsvps" (
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."event_saves" (
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."experience_levels" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "image_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lottie_url" text,
  "lottie_format" text
);

CREATE TABLE "public"."fcm_tokens" (
  "token" text NOT NULL,
  "user_id" uuid NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."interaction_reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "reporter_id" uuid,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "context_id" uuid,
  "community_id" uuid,
  "target_author_id" uuid,
  "target_author_name" text,
  "target_excerpt" text,
  "context_title" text,
  "reason" text NOT NULL,
  "details" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "target_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "resolution_note" text,
  "reporter_deleted_at" timestamp with time zone
);

CREATE TABLE "public"."invitations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid NOT NULL,
  "token" text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."job_applications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "applicant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "portfolio_url" text NOT NULL,
  "linkedin_url" text NOT NULL,
  "resume_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'new'::text NOT NULL,
  "resume_key" text
);

CREATE TABLE "public"."job_posts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "poster_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "city_id" uuid,
  "sector_id" uuid,
  "job_title" text NOT NULL,
  "experience_level" text NOT NULL,
  "work_mode" text NOT NULL,
  "employment_type" text NOT NULL,
  "salary" text,
  "description" text NOT NULL,
  "responsibilities" text[] DEFAULT '{}'::text[] NOT NULL,
  "requirements" text[] DEFAULT '{}'::text[] NOT NULL,
  "skills" text[] DEFAULT '{}'::text[] NOT NULL,
  "website" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "updated_at" timestamp with time zone,
  "closes_at" timestamp with time zone,
  "moderated_at" timestamp with time zone,
  "moderation_note" text
);

CREATE TABLE "public"."job_titles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "image_url" text,
  "lottie_url" text,
  "lottie_format" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."library_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid,
  "showcase_id" uuid,
  "resource_id" uuid,
  "item_type" text GENERATED ALWAYS AS (
CASE
    WHEN (thread_id IS NOT NULL) THEN 'thread'::text
    WHEN (showcase_id IS NOT NULL) THEN 'showcase'::text
    ELSE 'resource'::text
END) STORED,
  "featured_rank" integer NOT NULL,
  "curated_by" uuid,
  "curated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."lottie_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "scope_key" text NOT NULL,
  "lottie_url" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."member_resumes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "url" text,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "storage_key" text
);

CREATE TABLE "public"."message_reactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL,
  "community_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."moderation_appeals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "report_id" uuid,
  "user_id" uuid,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "message" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "resolution_note" text,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_deleted_at" timestamp with time zone,
  "report_deleted_at" timestamp with time zone
);

CREATE TABLE "public"."moderation_audit_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "moderator_id" uuid,
  "moderator_sid" text,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "report_id" uuid,
  "subject_user_id" uuid,
  "previous_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "new_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "moderator_label" text
);

CREATE TABLE "public"."moderation_audit_log_legacy_20261030" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "moderator_email" text NOT NULL,
  "action" text NOT NULL,
  "target_user_id" uuid,
  "target_content_type" text,
  "target_content_id" uuid,
  "reason" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."moderation_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "content_type" text NOT NULL,
  "content_id" uuid,
  "content_preview" text,
  "user_id" uuid,
  "community_id" uuid,
  "provider" text NOT NULL,
  "confidence" double precision,
  "reason" text,
  "raw_response" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."moderation_settings" (
  "key" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."notification_preferences" (
  "user_id" uuid NOT NULL,
  "chat_push_enabled" boolean DEFAULT true NOT NULL,
  "chat_sound" text DEFAULT 'default'::text NOT NULL,
  "quiet_hours_enabled" boolean DEFAULT false NOT NULL,
  "quiet_hours_start" time without time zone DEFAULT '22:00:00'::time without time zone NOT NULL,
  "quiet_hours_end" time without time zone DEFAULT '07:00:00'::time without time zone NOT NULL,
  "quiet_hours_timezone" text DEFAULT 'UTC'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "email_job_updates" boolean DEFAULT true NOT NULL,
  "email_community_activity" boolean DEFAULT true NOT NULL,
  "email_product_news" boolean DEFAULT false NOT NULL
);

CREATE TABLE "public"."notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "actor_id" uuid,
  "community_id" uuid,
  "type" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "title" character varying(160) NOT NULL,
  "body" text,
  "href" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."password_resets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token" text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."profile_field_changes" (
  "user_id" uuid NOT NULL,
  "field" text NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."push_throttle" (
  "user_id" uuid NOT NULL,
  "community_id" uuid NOT NULL,
  "window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "public"."push_tokens" (
  "token" text NOT NULL,
  "user_id" uuid NOT NULL,
  "platform" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."resource_bookmarks" (
  "resource_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."resource_comment_reactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."resource_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "parent_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."resource_saves" (
  "resource_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."showcase_comment_reactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."showcase_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "parent_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."showcase_likes" (
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."showcase_saves" (
  "post_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."signup_attempts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "flow" text DEFAULT 'direct'::text NOT NULL,
  "application_id" uuid,
  "status" text DEFAULT 'started'::text NOT NULL,
  "user_id" uuid,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "resume_token" text,
  "resume_token_expires_at" timestamp with time zone,
  "resume_email_sent_at" timestamp with time zone
);

CREATE TABLE "public"."tags" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL
);

CREATE TABLE "public"."thread_comment_reactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."thread_comments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "parent_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."thread_likes" (
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."thread_poll_votes" (
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "option_index" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "undo_used" boolean DEFAULT false NOT NULL
);

CREATE TABLE "public"."thread_saves" (
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."usage_counters" (
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "period_key" text NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."user_blocks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "blocker_id" uuid NOT NULL,
  "blocked_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."user_punishments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "type" punishment_type NOT NULL,
  "reason" text NOT NULL,
  "expires_at" timestamp with time zone,
  "moderator_note" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" text
);

CREATE TABLE "public"."users" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "application_id" uuid,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_blocked" boolean DEFAULT false NOT NULL,
  "verification_status" text DEFAULT 'unverified'::text NOT NULL,
  "verification_rejection_reason" text,
  "verification_reapply_at" timestamp with time zone,
  "verification_reviewed_at" timestamp with time zone,
  "verification_notified_at" timestamp with time zone,
  "email_verified_at" timestamp with time zone,
  "age_confirmed_at" timestamp with time zone,
  "terms_accepted_at" timestamp with time zone,
  "session_version" integer DEFAULT 1 NOT NULL,
  "suspended_until" timestamp with time zone,
  "terms_version" text
);

CREATE TABLE "public"."verification_email_codes" (
  "user_id" uuid NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."verification_settings" (
  "id" boolean DEFAULT true NOT NULL,
  "grace_days" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "public"."account_verification_requests" ADD CONSTRAINT "account_verification_requests_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."account_verification_requests" ADD CONSTRAINT "account_verification_requests_portfolio_len" CHECK (cardinality(portfolio_links) >= 1 AND cardinality(portfolio_links) <= 2);

ALTER TABLE "public"."account_verification_requests" ADD CONSTRAINT "account_verification_requests_sample_keys_len" CHECK (cardinality(work_sample_keys) <= 3);

ALTER TABLE "public"."account_verification_requests" ADD CONSTRAINT "account_verification_requests_sample_keys_shape" CHECK (array_to_string(work_sample_keys, ','::text) !~~ 'http%'::text AND array_to_string(work_sample_keys, ','::text) !~~ '%..%'::text);

ALTER TABLE "public"."account_verification_requests" ADD CONSTRAINT "account_verification_requests_samples_len" CHECK (cardinality(work_sample_urls) <= 3);

ALTER TABLE "public"."account_verification_requests" ADD CONSTRAINT "account_verification_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE "public"."application_tags" ADD CONSTRAINT "application_tags_pkey" PRIMARY KEY (application_id, tag_id);

ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_expiry_after_creation" CHECK (expires_at > created_at);

ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_role_check" CHECK (role = ANY (ARRAY['user'::text, 'admin'::text]));

ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_subject" CHECK (role = 'user'::text AND user_id IS NOT NULL OR role = 'admin'::text AND user_id IS NULL);

ALTER TABLE "public"."cities" ADD CONSTRAINT "cities_lottie_format_check" CHECK (lottie_format IS NULL OR (lottie_format = ANY (ARRAY['json'::text, 'dotlottie'::text])));

ALTER TABLE "public"."cities" ADD CONSTRAINT "cities_name_key" UNIQUE (name);

ALTER TABLE "public"."cities" ADD CONSTRAINT "cities_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_enabled_tabs_check" CHECK (enabled_tabs <@ ARRAY['chat'::text, 'threads'::text, 'events'::text, 'resources'::text] AND ('chat'::text = ANY (enabled_tabs)));

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_lottie_format_check" CHECK (lottie_format IS NULL OR (lottie_format = ANY (ARRAY['json'::text, 'dotlottie'::text])));

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_member_count_nonnegative" CHECK (member_count >= 0);

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_type_check" CHECK (type = ANY (ARRAY['city'::text, 'sector'::text, 'experience_level'::text, 'job_title'::text, 'user'::text, 'event'::text]));

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_type_reference_id_key" UNIQUE (type, reference_id);

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_user_requires_owner" CHECK (type <> 'user'::text OR owner_id IS NOT NULL) NOT VALID;

ALTER TABLE "public"."community_admin_activity" ADD CONSTRAINT "community_admin_activity_actor_role_check" CHECK (actor_role = ANY (ARRAY['owner'::text, 'admin'::text, 'moderator'::text, 'platform'::text]));

ALTER TABLE "public"."community_admin_activity" ADD CONSTRAINT "community_admin_activity_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_admin_permissions" ADD CONSTRAINT "community_admin_permissions_pkey" PRIMARY KEY (community_id, user_id);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_check" CHECK (end_date IS NULL OR end_date > event_date);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_cover_image_url_check" CHECK (cover_image_url IS NULL OR char_length(cover_image_url) <= 2048);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_description_check" CHECK (description IS NULL OR char_length(description) <= 5000);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_host_timezone_len" CHECK (host_timezone IS NULL OR char_length(host_timezone) >= 1 AND char_length(host_timezone) <= 64);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_host_utc_offset_range" CHECK (host_utc_offset_minutes IS NULL OR host_utc_offset_minutes >= '-840'::integer AND host_utc_offset_minutes <= 840);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_location_check" CHECK (location IS NULL OR char_length(location) <= 500);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_max_attendees_check" CHECK (max_attendees IS NULL OR max_attendees > 0);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_meet_link_check" CHECK (meet_link IS NULL OR char_length(meet_link) <= 2048);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_title_check" CHECK (char_length(title::text) >= 1 AND char_length(title::text) <= 120);

ALTER TABLE "public"."community_join_requests" ADD CONSTRAINT "community_join_requests_community_id_user_id_key" UNIQUE (community_id, user_id);

ALTER TABLE "public"."community_join_requests" ADD CONSTRAINT "community_join_requests_message_len_check" CHECK (char_length(request_message) <= 500);

ALTER TABLE "public"."community_join_requests" ADD CONSTRAINT "community_join_requests_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_join_requests" ADD CONSTRAINT "community_join_requests_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]));

ALTER TABLE "public"."community_members" ADD CONSTRAINT "community_members_pkey" PRIMARY KEY (community_id, user_id);

ALTER TABLE "public"."community_members" ADD CONSTRAINT "community_members_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'moderator'::text, 'member'::text]));

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_content_check" CHECK (deleted_at IS NOT NULL OR content IS NOT NULL AND length(content) >= 1 AND length(content) <= 2000 OR image_url IS NOT NULL);

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_deleted_by_role_check" CHECK (deleted_by_role IS NULL OR (deleted_by_role = ANY (ARRAY['owner'::text, 'admin'::text, 'moderator'::text])));

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_image_status_check" CHECK (image_status IS NULL OR (image_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'review_required'::text])));

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_resources" ADD CONSTRAINT "community_resources_description_check" CHECK (description IS NULL OR char_length(description) <= 2000);

ALTER TABLE "public"."community_resources" ADD CONSTRAINT "community_resources_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_resources" ADD CONSTRAINT "community_resources_resource_type_check" CHECK (resource_type = ANY (ARRAY['figma'::text, 'article'::text, 'tool'::text, 'video'::text, 'book'::text, 'font'::text, 'icon_pack'::text, 'color'::text, 'template'::text, 'inspiration'::text, 'other'::text]));

ALTER TABLE "public"."community_resources" ADD CONSTRAINT "community_resources_title_check" CHECK (char_length(title::text) >= 1 AND char_length(title::text) <= 120);

ALTER TABLE "public"."community_resources" ADD CONSTRAINT "community_resources_url_check" CHECK (char_length(url) >= 1 AND char_length(url) <= 2048);

ALTER TABLE "public"."community_rules" ADD CONSTRAINT "community_rules_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_rules" ADD CONSTRAINT "community_rules_rule_text_check" CHECK (char_length(TRIM(BOTH FROM rule_text)) >= 1 AND char_length(TRIM(BOTH FROM rule_text)) <= 500);

ALTER TABLE "public"."community_showcase_posts" ADD CONSTRAINT "community_showcase_posts_attachments_array_check" CHECK (jsonb_typeof(attachments) = 'array'::text);

ALTER TABLE "public"."community_showcase_posts" ADD CONSTRAINT "community_showcase_posts_category_check" CHECK (category = ANY (ARRAY['product_design'::text, 'ai_design'::text, 'ux_research'::text, 'ui_design'::text, 'portfolio'::text, 'case_study'::text, 'graphic_design'::text, 'motion_design'::text, 'illustration'::text, '3d_design'::text, 'other'::text]));

ALTER TABLE "public"."community_showcase_posts" ADD CONSTRAINT "community_showcase_posts_image_url_check" CHECK (char_length(image_url) <= 2048);

ALTER TABLE "public"."community_showcase_posts" ADD CONSTRAINT "community_showcase_posts_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_showcase_posts" ADD CONSTRAINT "community_showcase_posts_title_check" CHECK (char_length(title) >= 1 AND char_length(title) <= 2000);

ALTER TABLE "public"."community_threads" ADD CONSTRAINT "community_threads_attachments_check" CHECK (jsonb_typeof(attachments) = 'array'::text);

ALTER TABLE "public"."community_threads" ADD CONSTRAINT "community_threads_category_check" CHECK (category = ANY (ARRAY['question'::text, 'discussion'::text, 'idea'::text, 'feedback'::text]));

ALTER TABLE "public"."community_threads" ADD CONSTRAINT "community_threads_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."community_threads" ADD CONSTRAINT "community_threads_poll_object_check" CHECK (poll IS NULL OR jsonb_typeof(poll) = 'object'::text);

ALTER TABLE "public"."community_threads" ADD CONSTRAINT "community_threads_title_check" CHECK (char_length(title::text) >= 1 AND char_length(title::text) <= 2000);

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_entity_status_check" CHECK (entity_status = ANY (ARRAY['active'::text, 'inactive'::text, 'dissolved'::text, 'acquired'::text, 'unknown'::text]));

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_featured_rank_check" CHECK (featured_rank IS NULL OR is_active AND featured_rank >= 1);

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_name_check" CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 120);

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_slug_check" CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'::text);

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_slug_key" UNIQUE (slug);

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_source_confidence_check" CHECK (source_confidence IS NULL OR (source_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'unknown'::text])));

ALTER TABLE "public"."company_aliases" ADD CONSTRAINT "company_aliases_alias_check" CHECK (char_length(btrim(alias)) >= 1 AND char_length(btrim(alias)) <= 120);

ALTER TABLE "public"."company_aliases" ADD CONSTRAINT "company_aliases_alias_type_check" CHECK (alias_type = ANY (ARRAY['alias'::text, 'former_name'::text, 'brand'::text, 'abbreviation'::text, 'transliteration'::text]));

ALTER TABLE "public"."company_aliases" ADD CONSTRAINT "company_aliases_company_alias_key" UNIQUE (company_id, alias);

ALTER TABLE "public"."company_aliases" ADD CONSTRAINT "company_aliases_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."company_directory_seed_retired" ADD CONSTRAINT "company_directory_seed_retired_name_check" CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 120);

ALTER TABLE "public"."company_directory_seed_retired" ADD CONSTRAINT "company_directory_seed_retired_pkey" PRIMARY KEY (name);

ALTER TABLE "public"."company_directory_seed_retired" ADD CONSTRAINT "company_directory_seed_retired_slug_check" CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'::text);

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_domain_check" CHECK (domain = lower(btrim(domain)));

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_evidence_check" CHECK (jsonb_typeof(evidence) = 'array'::text);

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_not_self" CHECK (company_id <> granted_by);

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_review_status_check" CHECK (review_status = ANY (ARRAY['unreviewed'::text, 'reviewed'::text, 'rejected'::text]));

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_unique" UNIQUE (company_id, domain);

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_after_confidence_check" CHECK (after_confidence IS NULL OR (after_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'unknown'::text])));

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_confidence_check" CHECK (before_confidence IS NULL OR (before_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'unknown'::text])));

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_decision_check" CHECK (decision = ANY (ARRAY['promote'::text, 'reject'::text, 'needs_more_evidence'::text]));

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_domain_check" CHECK (domain = lower(btrim(domain)) AND length(domain) >= 4);

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_reason_check" CHECK (char_length(btrim(reason)) >= 3 AND char_length(btrim(reason)) <= 1000);

ALTER TABLE "public"."company_domains" ADD CONSTRAINT "company_domains_company_domain_key" UNIQUE (company_id, domain);

ALTER TABLE "public"."company_domains" ADD CONSTRAINT "company_domains_confidence_check" CHECK (evidence_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'unknown'::text]));

ALTER TABLE "public"."company_domains" ADD CONSTRAINT "company_domains_domain_check" CHECK (domain = lower(btrim(domain)) AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'::text);

ALTER TABLE "public"."company_domains" ADD CONSTRAINT "company_domains_domain_type_check" CHECK (domain_type = ANY (ARRAY['primary_website'::text, 'corporate_email'::text, 'subsidiary_email'::text, 'brand'::text, 'subsidiary'::text, 'regional'::text, 'historical'::text, 'alias'::text]));

ALTER TABLE "public"."company_domains" ADD CONSTRAINT "company_domains_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."company_domains" ADD CONSTRAINT "company_domains_verified_at_check" CHECK (verified AND verified_at IS NOT NULL OR NOT verified AND verified_at IS NULL);

ALTER TABLE "public"."company_email_verifications" ADD CONSTRAINT "company_email_verifications_company_name_check" CHECK (char_length(btrim(company_name)) >= 1 AND char_length(btrim(company_name)) <= 120);

ALTER TABLE "public"."company_email_verifications" ADD CONSTRAINT "company_email_verifications_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."company_members" ADD CONSTRAINT "company_members_company_user_key" UNIQUE (company_id, user_id);

ALTER TABLE "public"."company_members" ADD CONSTRAINT "company_members_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."company_relationships" ADD CONSTRAINT "company_relationships_not_self" CHECK (parent_company_id <> child_company_id);

ALTER TABLE "public"."company_relationships" ADD CONSTRAINT "company_relationships_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."company_relationships" ADD CONSTRAINT "company_relationships_relationship_type_check" CHECK (relationship_type = ANY (ARRAY['parent'::text, 'subsidiary'::text, 'brand'::text, 'division'::text, 'acquired_company'::text, 'former_name'::text]));

ALTER TABLE "public"."company_relationships" ADD CONSTRAINT "company_relationships_unique" UNIQUE (parent_company_id, child_company_id, relationship_type);

ALTER TABLE "public"."content_reactions" ADD CONSTRAINT "content_reactions_content_id_content_kind_user_id_key" UNIQUE (content_id, content_kind, user_id);

ALTER TABLE "public"."content_reactions" ADD CONSTRAINT "content_reactions_content_kind_check" CHECK (content_kind = ANY (ARRAY['thread'::text, 'showcase'::text, 'resource'::text, 'event'::text]));

ALTER TABLE "public"."content_reactions" ADD CONSTRAINT "content_reactions_emoji_check" CHECK (char_length(emoji) <= 10);

ALTER TABLE "public"."content_reactions" ADD CONSTRAINT "content_reactions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."content_removals" ADD CONSTRAINT "content_removals_content_type_check" CHECK (content_type = ANY (ARRAY['thread'::text, 'showcase'::text, 'resource'::text, 'event'::text]));

ALTER TABLE "public"."content_removals" ADD CONSTRAINT "content_removals_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_content_type_check" CHECK (content_type = ANY (ARRAY['thread'::text, 'showcase'::text, 'resource'::text, 'event'::text]));

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_reason_check" CHECK (reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'misinformation'::text, 'inappropriate'::text, 'intellectual_property'::text, 'off_topic'::text, 'other'::text]));

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'removed'::text, 'dismissed'::text]));

ALTER TABLE "public"."creation_limits" ADD CONSTRAINT "creation_limits_limit_count_check" CHECK (limit_count > 0);

ALTER TABLE "public"."creation_limits" ADD CONSTRAINT "creation_limits_period_check" CHECK (period = ANY (ARRAY['day'::text, 'month'::text, 'total'::text, 'standing'::text]));

ALTER TABLE "public"."creation_limits" ADD CONSTRAINT "creation_limits_pkey" PRIMARY KEY (kind);

ALTER TABLE "public"."design_sectors" ADD CONSTRAINT "design_sectors_lottie_format_check" CHECK (lottie_format IS NULL OR (lottie_format = ANY (ARRAY['json'::text, 'dotlottie'::text])));

ALTER TABLE "public"."design_sectors" ADD CONSTRAINT "design_sectors_name_key" UNIQUE (name);

ALTER TABLE "public"."design_sectors" ADD CONSTRAINT "design_sectors_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_avatar_source_check" CHECK (avatar_source IS NULL OR avatar_source = 'upload'::text);

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_user_id_key" UNIQUE (user_id);

ALTER TABLE "public"."dm_conversations" ADD CONSTRAINT "dm_conversations_pair_order" CHECK (user_a < user_b);

ALTER TABLE "public"."dm_conversations" ADD CONSTRAINT "dm_conversations_pair_unique" UNIQUE (user_a, user_b);

ALTER TABLE "public"."dm_conversations" ADD CONSTRAINT "dm_conversations_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."dm_conversations" ADD CONSTRAINT "dm_conversations_request_state_check" CHECK (request_state = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]));

ALTER TABLE "public"."dm_message_reactions" ADD CONSTRAINT "dm_message_reactions_emoji_check" CHECK (char_length(emoji) <= 10);

ALTER TABLE "public"."dm_message_reactions" ADD CONSTRAINT "dm_message_reactions_message_user_unique" UNIQUE (message_id, user_id);

ALTER TABLE "public"."dm_message_reactions" ADD CONSTRAINT "dm_message_reactions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."dm_messages" ADD CONSTRAINT "dm_messages_content_len" CHECK (content IS NULL OR char_length(content) >= 1 AND char_length(content) <= 2000);

ALTER TABLE "public"."dm_messages" ADD CONSTRAINT "dm_messages_image_key_shape" CHECK (image_key IS NULL OR image_key ~~ 'dm/%'::text AND image_key !~~ '%..%'::text AND image_key !~~ 'http%'::text);

ALTER TABLE "public"."dm_messages" ADD CONSTRAINT "dm_messages_payload_present" CHECK (deleted_at IS NOT NULL OR image_url IS NOT NULL OR image_key IS NOT NULL OR content IS NOT NULL);

ALTER TABLE "public"."dm_messages" ADD CONSTRAINT "dm_messages_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."dm_reports" ADD CONSTRAINT "dm_reports_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."dm_reports" ADD CONSTRAINT "dm_reports_reason_check" CHECK (reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'misinformation'::text, 'inappropriate'::text, 'intellectual_property'::text, 'off_topic'::text, 'other'::text]));

ALTER TABLE "public"."dm_reports" ADD CONSTRAINT "dm_reports_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'dismissed'::text]));

ALTER TABLE "public"."domain_evidence" ADD CONSTRAINT "domain_evidence_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."domain_evidence" ADD CONSTRAINT "domain_evidence_type_check" CHECK (evidence_type <> ALL (ARRAY['redirect_from_website'::text, 'website_domain_match'::text, 'mx_only'::text]));

ALTER TABLE "public"."event_chat_join_responses" ADD CONSTRAINT "event_chat_join_responses_expectations_check" CHECK (char_length(expectations) >= 1 AND char_length(expectations) <= 2000);

ALTER TABLE "public"."event_chat_join_responses" ADD CONSTRAINT "event_chat_join_responses_pkey" PRIMARY KEY (community_id, user_id);

ALTER TABLE "public"."event_chat_join_responses" ADD CONSTRAINT "event_chat_join_responses_why_attend_check" CHECK (char_length(why_attend) >= 1 AND char_length(why_attend) <= 2000);

ALTER TABLE "public"."event_comment_reactions" ADD CONSTRAINT "event_comment_reactions_emoji_check" CHECK (emoji = ANY (ARRAY['👍'::text, '❤️'::text, '🎉'::text, '💡'::text, '👏'::text]));

ALTER TABLE "public"."event_comment_reactions" ADD CONSTRAINT "event_comment_reactions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."event_comment_reactions" ADD CONSTRAINT "event_comment_reactions_unique" UNIQUE (comment_id, user_id, emoji);

ALTER TABLE "public"."event_comments" ADD CONSTRAINT "event_comments_body_check" CHECK (char_length(body) >= 1 AND char_length(body) <= 2000);

ALTER TABLE "public"."event_comments" ADD CONSTRAINT "event_comments_image_url_check" CHECK (image_url IS NULL OR char_length(image_url) <= 2048);

ALTER TABLE "public"."event_comments" ADD CONSTRAINT "event_comments_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."event_likes" ADD CONSTRAINT "event_likes_pkey" PRIMARY KEY (event_id, user_id);

ALTER TABLE "public"."event_notification_deliveries" ADD CONSTRAINT "event_notification_deliveries_pkey" PRIMARY KEY (event_id, user_id, stage);

ALTER TABLE "public"."event_notification_deliveries" ADD CONSTRAINT "event_notification_deliveries_stage_check" CHECK (stage = ANY (ARRAY['tomorrow'::text, 'today'::text, 'soon'::text, 'live'::text, 'ended'::text]));

ALTER TABLE "public"."event_rsvps" ADD CONSTRAINT "event_rsvps_pkey" PRIMARY KEY (event_id, user_id);

ALTER TABLE "public"."event_saves" ADD CONSTRAINT "event_saves_pkey" PRIMARY KEY (event_id, user_id);

ALTER TABLE "public"."experience_levels" ADD CONSTRAINT "experience_levels_lottie_format_check" CHECK (lottie_format IS NULL OR (lottie_format = ANY (ARRAY['json'::text, 'dotlottie'::text])));

ALTER TABLE "public"."experience_levels" ADD CONSTRAINT "experience_levels_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."experience_levels" ADD CONSTRAINT "experience_levels_slug_key" UNIQUE (slug);

ALTER TABLE "public"."fcm_tokens" ADD CONSTRAINT "fcm_tokens_pkey" PRIMARY KEY (token);

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_reason_check" CHECK (reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'misinformation'::text, 'inappropriate'::text, 'intellectual_property'::text, 'off_topic'::text, 'other'::text, 'impersonation'::text, 'illegal'::text, 'scam'::text, 'discriminatory'::text, 'payment_request'::text, 'expired'::text]));

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'removed'::text, 'actioned'::text, 'dismissed'::text]));

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_target_type_check" CHECK (target_type = ANY (ARRAY['thread_comment'::text, 'showcase_comment'::text, 'resource_comment'::text, 'event_comment'::text, 'community_message'::text, 'profile'::text, 'community'::text, 'job'::text]));

ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_token_key" UNIQUE (token);

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_job_applicant_key" UNIQUE (job_id, applicant_id);

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_linkedin_url_check" CHECK (linkedin_url ~* '^https?://'::text);

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_name_check" CHECK (char_length(btrim(name)) >= 2 AND char_length(btrim(name)) <= 120);

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_portfolio_url_check" CHECK (portfolio_url ~* '^https?://'::text);

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_resume_key_shape" CHECK (resume_key IS NULL OR resume_key ~~ 'resumes/%'::text AND resume_key !~~ '%..%'::text AND resume_key !~~ 'http%'::text);

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_status_check" CHECK (status = ANY (ARRAY['new'::text, 'shortlisted'::text, 'rejected'::text]));

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_description_check" CHECK (char_length(btrim(description)) >= 1 AND char_length(btrim(description)) <= 24000);

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_employment_type_check" CHECK (employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'contract'::text, 'internship'::text]));

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_kind_check" CHECK (kind = ANY (ARRAY['hiring'::text, 'referral'::text]));

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_status_check" CHECK (status = ANY (ARRAY['open'::text, 'closed'::text]));

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_title_check" CHECK (char_length(btrim(title)) >= 2 AND char_length(btrim(title)) <= 140);

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_website_check" CHECK (website IS NULL OR website ~* '^https?://'::text);

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_work_mode_check" CHECK (work_mode = ANY (ARRAY['remote'::text, 'hybrid'::text, 'onsite'::text]));

ALTER TABLE "public"."job_titles" ADD CONSTRAINT "job_titles_lottie_format_check" CHECK (lottie_format IS NULL OR (lottie_format = ANY (ARRAY['json'::text, 'dotlottie'::text])));

ALTER TABLE "public"."job_titles" ADD CONSTRAINT "job_titles_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."job_titles" ADD CONSTRAINT "job_titles_slug_key" UNIQUE (slug);

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_featured_rank_check" CHECK (featured_rank >= 1);

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_one_kind" CHECK (num_nonnulls(thread_id, showcase_id, resource_id) = 1);

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_resource_id_key" UNIQUE (resource_id);

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_showcase_id_key" UNIQUE (showcase_id);

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_thread_id_key" UNIQUE (thread_id);

ALTER TABLE "public"."lottie_settings" ADD CONSTRAINT "lottie_settings_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."lottie_settings" ADD CONSTRAINT "lottie_settings_scope_check" CHECK (scope = ANY (ARRAY['universal'::text, 'type'::text, 'community'::text]));

ALTER TABLE "public"."lottie_settings" ADD CONSTRAINT "lottie_settings_scope_scope_key_key" UNIQUE (scope, scope_key);

ALTER TABLE "public"."member_resumes" ADD CONSTRAINT "member_resumes_location_present" CHECK (url IS NOT NULL OR storage_key IS NOT NULL);

ALTER TABLE "public"."member_resumes" ADD CONSTRAINT "member_resumes_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."member_resumes" ADD CONSTRAINT "member_resumes_storage_key_shape" CHECK (storage_key IS NULL OR storage_key ~~ 'resumes/%'::text AND storage_key !~~ '%..%'::text AND storage_key !~~ 'http%'::text);

ALTER TABLE "public"."message_reactions" ADD CONSTRAINT "message_reactions_emoji_check" CHECK (char_length(emoji) <= 10);

ALTER TABLE "public"."message_reactions" ADD CONSTRAINT "message_reactions_message_id_user_id_key" UNIQUE (message_id, user_id);

ALTER TABLE "public"."message_reactions" ADD CONSTRAINT "message_reactions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."moderation_appeals" ADD CONSTRAINT "moderation_appeals_message_check" CHECK (char_length(btrim(message)) >= 20 AND char_length(btrim(message)) <= 2000);

ALTER TABLE "public"."moderation_appeals" ADD CONSTRAINT "moderation_appeals_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."moderation_appeals" ADD CONSTRAINT "moderation_appeals_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'granted'::text, 'denied'::text]));

ALTER TABLE "public"."moderation_audit_log" ADD CONSTRAINT "moderation_audit_log_action_check" CHECK (action = ANY (ARRAY['dismiss_report'::text, 'remove_content'::text, 'restore_content'::text, 'reopen_report'::text, 'hide_community'::text, 'deactivate_job'::text, 'warn_user'::text, 'suspend_user'::text, 'ban_user'::text, 'unban_user'::text, 'lift_suspension'::text, 'grant_appeal'::text, 'deny_appeal'::text, 'delete_user'::text, 'review_dm_report'::text, 'reopen_dm_report'::text, 'toggle_community'::text, 'delete_community'::text, 'toggle_job'::text, 'delete_job'::text, 'delete_event'::text, 'review_verification'::text]));

ALTER TABLE "public"."moderation_audit_log" ADD CONSTRAINT "moderation_audit_log_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."moderation_audit_log_legacy_20261030" ADD CONSTRAINT "moderation_audit_log_pkey_legacy_20261030" PRIMARY KEY (id);

ALTER TABLE "public"."moderation_logs" ADD CONSTRAINT "moderation_logs_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."moderation_settings" ADD CONSTRAINT "moderation_settings_pkey" PRIMARY KEY (key);

ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_chat_sound_check" CHECK (chat_sound = ANY (ARRAY['default'::text, 'silent'::text]));

ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY (user_id);

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_entity_type_check" CHECK (entity_type = ANY (ARRAY['community'::text, 'thread'::text, 'resource'::text, 'event'::text, 'message'::text, 'showcase'::text, 'job'::text, 'verification'::text, 'profile'::text, 'moderation'::text]));

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_type_check" CHECK (type = ANY (ARRAY['thread_comment'::text, 'thread_reply'::text, 'thread_like'::text, 'resource_comment'::text, 'resource_reply'::text, 'event_comment'::text, 'event_reply'::text, 'event_rsvp'::text, 'thread_deleted'::text, 'showcase_deleted'::text, 'resource_deleted'::text, 'event_deleted'::text, 'report_reviewed'::text, 'content_restored'::text, 'job_match'::text, 'join_request_accepted'::text, 'event_reminder'::text, 'event_live'::text, 'event_ended'::text, 'verification_approved'::text, 'verification_rejected'::text, 'verification_reapply_ready'::text, 'moderation_action'::text, 'appeal_reviewed'::text]));

ALTER TABLE "public"."password_resets" ADD CONSTRAINT "password_resets_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."password_resets" ADD CONSTRAINT "password_resets_token_key" UNIQUE (token);

ALTER TABLE "public"."profile_field_changes" ADD CONSTRAINT "profile_field_changes_field_check" CHECK (field = ANY (ARRAY['name'::text, 'job_title'::text, 'experience_level'::text, 'city'::text, 'sector'::text]));

ALTER TABLE "public"."profile_field_changes" ADD CONSTRAINT "profile_field_changes_pkey" PRIMARY KEY (user_id, field);

ALTER TABLE "public"."push_throttle" ADD CONSTRAINT "push_throttle_pkey" PRIMARY KEY (user_id, community_id);

ALTER TABLE "public"."push_tokens" ADD CONSTRAINT "push_tokens_pkey" PRIMARY KEY (token);

ALTER TABLE "public"."push_tokens" ADD CONSTRAINT "push_tokens_platform_check" CHECK (platform = ANY (ARRAY['ios'::text, 'android'::text]));

ALTER TABLE "public"."resource_bookmarks" ADD CONSTRAINT "resource_bookmarks_pkey" PRIMARY KEY (resource_id, user_id);

ALTER TABLE "public"."resource_comment_reactions" ADD CONSTRAINT "resource_comment_reactions_emoji_check" CHECK (emoji = ANY (ARRAY['👍'::text, '❤️'::text, '🎉'::text, '💡'::text, '👏'::text]));

ALTER TABLE "public"."resource_comment_reactions" ADD CONSTRAINT "resource_comment_reactions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."resource_comment_reactions" ADD CONSTRAINT "resource_comment_reactions_unique" UNIQUE (comment_id, user_id, emoji);

ALTER TABLE "public"."resource_comments" ADD CONSTRAINT "resource_comments_body_length_check" CHECK (char_length(body) >= 1 AND char_length(body) <= 5000);

ALTER TABLE "public"."resource_comments" ADD CONSTRAINT "resource_comments_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."resource_saves" ADD CONSTRAINT "resource_saves_pkey" PRIMARY KEY (resource_id, user_id);

ALTER TABLE "public"."showcase_comment_reactions" ADD CONSTRAINT "showcase_comment_reactions_emoji_check" CHECK (emoji = ANY (ARRAY['👍'::text, '❤️'::text, '🎉'::text, '💡'::text, '👏'::text]));

ALTER TABLE "public"."showcase_comment_reactions" ADD CONSTRAINT "showcase_comment_reactions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."showcase_comment_reactions" ADD CONSTRAINT "showcase_comment_reactions_unique" UNIQUE (comment_id, user_id, emoji);

ALTER TABLE "public"."showcase_comments" ADD CONSTRAINT "showcase_comments_body_check" CHECK (char_length(body) >= 1 AND char_length(body) <= 1000);

ALTER TABLE "public"."showcase_comments" ADD CONSTRAINT "showcase_comments_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."showcase_likes" ADD CONSTRAINT "showcase_likes_pkey" PRIMARY KEY (post_id, user_id);

ALTER TABLE "public"."showcase_saves" ADD CONSTRAINT "showcase_saves_pkey" PRIMARY KEY (post_id, user_id);

ALTER TABLE "public"."signup_attempts" ADD CONSTRAINT "signup_attempts_email_key" UNIQUE (email);

ALTER TABLE "public"."signup_attempts" ADD CONSTRAINT "signup_attempts_flow_check" CHECK (flow = ANY (ARRAY['direct'::text, 'invitation'::text]));

ALTER TABLE "public"."signup_attempts" ADD CONSTRAINT "signup_attempts_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."signup_attempts" ADD CONSTRAINT "signup_attempts_status_check" CHECK (status = ANY (ARRAY['started'::text, 'completed'::text]));

ALTER TABLE "public"."tags" ADD CONSTRAINT "tags_name_key" UNIQUE (name);

ALTER TABLE "public"."tags" ADD CONSTRAINT "tags_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."thread_comment_reactions" ADD CONSTRAINT "thread_comment_reactions_emoji_check" CHECK (emoji = ANY (ARRAY['👍'::text, '❤️'::text, '🎉'::text, '💡'::text, '👏'::text]));

ALTER TABLE "public"."thread_comment_reactions" ADD CONSTRAINT "thread_comment_reactions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."thread_comment_reactions" ADD CONSTRAINT "thread_comment_reactions_unique" UNIQUE (comment_id, user_id, emoji);

ALTER TABLE "public"."thread_comments" ADD CONSTRAINT "thread_comments_body_check" CHECK (char_length(body) >= 1 AND char_length(body) <= 5000);

ALTER TABLE "public"."thread_comments" ADD CONSTRAINT "thread_comments_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."thread_likes" ADD CONSTRAINT "thread_votes_pkey" PRIMARY KEY (thread_id, user_id);

ALTER TABLE "public"."thread_poll_votes" ADD CONSTRAINT "thread_poll_votes_option_index_check" CHECK (option_index IS NULL OR option_index >= 0);

ALTER TABLE "public"."thread_poll_votes" ADD CONSTRAINT "thread_poll_votes_pkey" PRIMARY KEY (thread_id, user_id);

ALTER TABLE "public"."thread_saves" ADD CONSTRAINT "thread_saves_pkey" PRIMARY KEY (thread_id, user_id);

ALTER TABLE "public"."usage_counters" ADD CONSTRAINT "usage_counters_pkey" PRIMARY KEY (user_id, kind, period_key);

ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "dm_blocks_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "user_blocks_no_self" CHECK (blocker_id <> blocked_id);

ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "user_blocks_pair_unique" UNIQUE (blocker_id, blocked_id);

ALTER TABLE "public"."user_punishments" ADD CONSTRAINT "user_punishments_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE (email);

ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."users" ADD CONSTRAINT "users_verification_status_check" CHECK (verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE "public"."verification_email_codes" ADD CONSTRAINT "verification_email_codes_pkey" PRIMARY KEY (user_id);

ALTER TABLE "public"."verification_settings" ADD CONSTRAINT "verification_settings_grace_days_check" CHECK (grace_days >= 0 AND grace_days <= 30);

ALTER TABLE "public"."verification_settings" ADD CONSTRAINT "verification_settings_id_check" CHECK (id);

ALTER TABLE "public"."verification_settings" ADD CONSTRAINT "verification_settings_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."account_verification_requests" ADD CONSTRAINT "account_verification_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."application_tags" ADD CONSTRAINT "application_tags_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;

ALTER TABLE "public"."application_tags" ADD CONSTRAINT "application_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;

ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_event_id_fkey" FOREIGN KEY (event_id) REFERENCES community_events(id) ON DELETE SET NULL;

ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_admin_activity" ADD CONSTRAINT "community_admin_activity_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_admin_activity" ADD CONSTRAINT "community_admin_activity_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_admin_activity" ADD CONSTRAINT "community_admin_activity_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_admin_permissions" ADD CONSTRAINT "community_admin_permissions_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_admin_permissions" ADD CONSTRAINT "community_admin_permissions_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_admin_permissions" ADD CONSTRAINT "community_admin_permissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_events" ADD CONSTRAINT "community_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_join_requests" ADD CONSTRAINT "community_join_requests_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_join_requests" ADD CONSTRAINT "community_join_requests_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_join_requests" ADD CONSTRAINT "community_join_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_members" ADD CONSTRAINT "community_members_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_members" ADD CONSTRAINT "community_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_deleted_by_fkey" FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_moderation_log_id_fkey" FOREIGN KEY (moderation_log_id) REFERENCES moderation_logs(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_reply_to_id_fkey" FOREIGN KEY (reply_to_id) REFERENCES community_messages(id) ON DELETE SET NULL;

ALTER TABLE "public"."community_messages" ADD CONSTRAINT "community_messages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_resources" ADD CONSTRAINT "community_resources_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_resources" ADD CONSTRAINT "community_resources_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_rules" ADD CONSTRAINT "community_rules_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_showcase_posts" ADD CONSTRAINT "community_showcase_posts_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_showcase_posts" ADD CONSTRAINT "community_showcase_posts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_threads" ADD CONSTRAINT "community_threads_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."community_threads" ADD CONSTRAINT "community_threads_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."companies" ADD CONSTRAINT "companies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."company_aliases" ADD CONSTRAINT "company_aliases_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_domain_delegations" ADD CONSTRAINT "company_domain_delegations_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_evidence_id_fkey" FOREIGN KEY (evidence_id) REFERENCES domain_evidence(id) ON DELETE SET NULL;

ALTER TABLE "public"."company_domain_reviews" ADD CONSTRAINT "company_domain_reviews_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES users(id);

ALTER TABLE "public"."company_domains" ADD CONSTRAINT "company_domains_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_email_verifications" ADD CONSTRAINT "company_email_verifications_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_email_verifications" ADD CONSTRAINT "company_email_verifications_domain_owner_company_id_fkey" FOREIGN KEY (domain_owner_company_id) REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE "public"."company_email_verifications" ADD CONSTRAINT "company_email_verifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_members" ADD CONSTRAINT "company_members_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_members" ADD CONSTRAINT "company_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_relationships" ADD CONSTRAINT "company_relationships_child_company_id_fkey" FOREIGN KEY (child_company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."company_relationships" ADD CONSTRAINT "company_relationships_parent_company_id_fkey" FOREIGN KEY (parent_company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."content_reactions" ADD CONSTRAINT "content_reactions_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."content_removals" ADD CONSTRAINT "content_removals_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL;

ALTER TABLE "public"."content_removals" ADD CONSTRAINT "content_removals_content_author_id_fkey" FOREIGN KEY (content_author_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."content_removals" ADD CONSTRAINT "content_removals_removed_by_fkey" FOREIGN KEY (removed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."content_removals" ADD CONSTRAINT "content_removals_undone_by_fkey" FOREIGN KEY (undone_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL;

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_content_author_id_fkey" FOREIGN KEY (content_author_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."content_reports" ADD CONSTRAINT "content_reports_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_city_id_fkey" FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT;

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_job_title_fkey" FOREIGN KEY (job_title) REFERENCES job_titles(slug) ON DELETE RESTRICT;

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_sector_id_fkey" FOREIGN KEY (sector_id) REFERENCES design_sectors(id) ON DELETE RESTRICT;

ALTER TABLE "public"."designer_profiles" ADD CONSTRAINT "designer_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_conversations" ADD CONSTRAINT "dm_conversations_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."dm_conversations" ADD CONSTRAINT "dm_conversations_user_a_fkey" FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_conversations" ADD CONSTRAINT "dm_conversations_user_b_fkey" FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_message_reactions" ADD CONSTRAINT "dm_message_reactions_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_message_reactions" ADD CONSTRAINT "dm_message_reactions_message_id_fkey" FOREIGN KEY (message_id) REFERENCES dm_messages(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_message_reactions" ADD CONSTRAINT "dm_message_reactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_messages" ADD CONSTRAINT "dm_messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_messages" ADD CONSTRAINT "dm_messages_reply_to_id_fkey" FOREIGN KEY (reply_to_id) REFERENCES dm_messages(id) ON DELETE SET NULL;

ALTER TABLE "public"."dm_messages" ADD CONSTRAINT "dm_messages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."dm_reports" ADD CONSTRAINT "dm_reports_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE SET NULL;

ALTER TABLE "public"."dm_reports" ADD CONSTRAINT "dm_reports_reported_user_id_fkey" FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."dm_reports" ADD CONSTRAINT "dm_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."dm_reports" ADD CONSTRAINT "dm_reports_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."domain_evidence" ADD CONSTRAINT "domain_evidence_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_chat_join_responses" ADD CONSTRAINT "event_chat_join_responses_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_chat_join_responses" ADD CONSTRAINT "event_chat_join_responses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_comment_reactions" ADD CONSTRAINT "event_comment_reactions_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES event_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_comment_reactions" ADD CONSTRAINT "event_comment_reactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_comments" ADD CONSTRAINT "event_comments_event_id_fkey" FOREIGN KEY (event_id) REFERENCES community_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_comments" ADD CONSTRAINT "event_comments_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES event_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_comments" ADD CONSTRAINT "event_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_likes" ADD CONSTRAINT "event_likes_event_id_fkey" FOREIGN KEY (event_id) REFERENCES community_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_likes" ADD CONSTRAINT "event_likes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_notification_deliveries" ADD CONSTRAINT "event_notification_deliveries_event_id_fkey" FOREIGN KEY (event_id) REFERENCES community_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_notification_deliveries" ADD CONSTRAINT "event_notification_deliveries_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_fkey" FOREIGN KEY (event_id) REFERENCES community_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_saves" ADD CONSTRAINT "event_saves_event_id_fkey" FOREIGN KEY (event_id) REFERENCES community_events(id) ON DELETE CASCADE;

ALTER TABLE "public"."event_saves" ADD CONSTRAINT "event_saves_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."fcm_tokens" ADD CONSTRAINT "fcm_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL;

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."interaction_reports" ADD CONSTRAINT "interaction_reports_target_author_id_fkey" FOREIGN KEY (target_author_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_applicant_id_fkey" FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY (job_id) REFERENCES job_posts(id) ON DELETE CASCADE;

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_city_id_fkey" FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT;

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_experience_level_fkey" FOREIGN KEY (experience_level) REFERENCES experience_levels(slug) ON DELETE RESTRICT;

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_job_title_fkey" FOREIGN KEY (job_title) REFERENCES job_titles(slug) ON DELETE RESTRICT;

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_poster_id_fkey" FOREIGN KEY (poster_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."job_posts" ADD CONSTRAINT "job_posts_sector_id_fkey" FOREIGN KEY (sector_id) REFERENCES design_sectors(id) ON DELETE RESTRICT;

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_curated_by_fkey" FOREIGN KEY (curated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES community_resources(id) ON DELETE CASCADE;

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_showcase_id_fkey" FOREIGN KEY (showcase_id) REFERENCES community_showcase_posts(id) ON DELETE CASCADE;

ALTER TABLE "public"."library_items" ADD CONSTRAINT "library_items_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES community_threads(id) ON DELETE CASCADE;

ALTER TABLE "public"."member_resumes" ADD CONSTRAINT "member_resumes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."message_reactions" ADD CONSTRAINT "message_reactions_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY (message_id) REFERENCES community_messages(id) ON DELETE CASCADE;

ALTER TABLE "public"."moderation_appeals" ADD CONSTRAINT "moderation_appeals_report_id_fkey" FOREIGN KEY (report_id) REFERENCES interaction_reports(id) ON DELETE SET NULL;

ALTER TABLE "public"."moderation_appeals" ADD CONSTRAINT "moderation_appeals_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."moderation_appeals" ADD CONSTRAINT "moderation_appeals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."moderation_audit_log_legacy_20261030" ADD CONSTRAINT "moderation_audit_log_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."moderation_logs" ADD CONSTRAINT "moderation_logs_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL;

ALTER TABLE "public"."moderation_logs" ADD CONSTRAINT "moderation_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."profile_field_changes" ADD CONSTRAINT "profile_field_changes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."push_throttle" ADD CONSTRAINT "push_throttle_community_id_fkey" FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE "public"."push_throttle" ADD CONSTRAINT "push_throttle_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_bookmarks" ADD CONSTRAINT "resource_bookmarks_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES community_resources(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_bookmarks" ADD CONSTRAINT "resource_bookmarks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_comment_reactions" ADD CONSTRAINT "resource_comment_reactions_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES resource_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_comment_reactions" ADD CONSTRAINT "resource_comment_reactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_comments" ADD CONSTRAINT "resource_comments_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES resource_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_comments" ADD CONSTRAINT "resource_comments_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES community_resources(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_comments" ADD CONSTRAINT "resource_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_saves" ADD CONSTRAINT "resource_saves_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES community_resources(id) ON DELETE CASCADE;

ALTER TABLE "public"."resource_saves" ADD CONSTRAINT "resource_saves_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_comment_reactions" ADD CONSTRAINT "showcase_comment_reactions_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES showcase_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_comment_reactions" ADD CONSTRAINT "showcase_comment_reactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_comments" ADD CONSTRAINT "showcase_comments_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES showcase_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_comments" ADD CONSTRAINT "showcase_comments_post_id_fkey" FOREIGN KEY (post_id) REFERENCES community_showcase_posts(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_comments" ADD CONSTRAINT "showcase_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_likes" ADD CONSTRAINT "showcase_likes_post_id_fkey" FOREIGN KEY (post_id) REFERENCES community_showcase_posts(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_likes" ADD CONSTRAINT "showcase_likes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_saves" ADD CONSTRAINT "showcase_saves_post_id_fkey" FOREIGN KEY (post_id) REFERENCES community_showcase_posts(id) ON DELETE CASCADE;

ALTER TABLE "public"."showcase_saves" ADD CONSTRAINT "showcase_saves_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."signup_attempts" ADD CONSTRAINT "signup_attempts_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;

ALTER TABLE "public"."signup_attempts" ADD CONSTRAINT "signup_attempts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE "public"."thread_comment_reactions" ADD CONSTRAINT "thread_comment_reactions_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES thread_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_comment_reactions" ADD CONSTRAINT "thread_comment_reactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_comments" ADD CONSTRAINT "thread_comments_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES thread_comments(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_comments" ADD CONSTRAINT "thread_comments_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES community_threads(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_comments" ADD CONSTRAINT "thread_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_likes" ADD CONSTRAINT "thread_votes_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES community_threads(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_likes" ADD CONSTRAINT "thread_votes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_poll_votes" ADD CONSTRAINT "thread_poll_votes_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES community_threads(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_poll_votes" ADD CONSTRAINT "thread_poll_votes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_saves" ADD CONSTRAINT "thread_saves_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES community_threads(id) ON DELETE CASCADE;

ALTER TABLE "public"."thread_saves" ADD CONSTRAINT "thread_saves_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."usage_counters" ADD CONSTRAINT "usage_counters_kind_fkey" FOREIGN KEY (kind) REFERENCES creation_limits(kind);

ALTER TABLE "public"."usage_counters" ADD CONSTRAINT "usage_counters_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "dm_blocks_blocked_id_fkey" FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_blocks" ADD CONSTRAINT "dm_blocks_blocker_id_fkey" FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_punishments" ADD CONSTRAINT "user_punishments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE "public"."users" ADD CONSTRAINT "users_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE RESTRICT;

ALTER TABLE "public"."verification_email_codes" ADD CONSTRAINT "verification_email_codes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX idx_account_verification_requests_status ON public.account_verification_requests USING btree (status, created_at DESC);

CREATE INDEX idx_account_verification_requests_user ON public.account_verification_requests USING btree (user_id, created_at DESC);

CREATE UNIQUE INDEX uq_account_verification_requests_pending ON public.account_verification_requests USING btree (user_id) WHERE (status = 'pending'::text);

CREATE INDEX idx_applications_applicant_email ON public.applications USING btree (applicant_email);

CREATE INDEX idx_applications_created_at ON public.applications USING btree (created_at DESC);

CREATE INDEX idx_applications_email ON public.applications USING btree (email);

CREATE INDEX idx_applications_status ON public.applications USING btree (status);

CREATE INDEX idx_auth_sessions_admin_active ON public.auth_sessions USING btree (expires_at) WHERE ((role = 'admin'::text) AND (revoked_at IS NULL));

CREATE INDEX idx_auth_sessions_user_active ON public.auth_sessions USING btree (user_id, expires_at) WHERE (revoked_at IS NULL);

CREATE INDEX idx_communities_active_name ON public.communities USING btree (name, id) WHERE (is_active = true);

CREATE UNIQUE INDEX idx_communities_event_id ON public.communities USING btree (event_id) WHERE (event_id IS NOT NULL);

CREATE UNIQUE INDEX idx_communities_invite_token ON public.communities USING btree (invite_token);

CREATE INDEX idx_communities_is_active ON public.communities USING btree (is_active);

CREATE INDEX idx_communities_owner ON public.communities USING btree (owner_id) WHERE (owner_id IS NOT NULL);

CREATE INDEX idx_communities_type_ref ON public.communities USING btree (type, reference_id);

CREATE INDEX idx_community_admin_activity_actor ON public.community_admin_activity USING btree (community_id, actor_id, created_at DESC);

CREATE INDEX idx_community_admin_activity_community ON public.community_admin_activity USING btree (community_id, created_at DESC);

CREATE INDEX community_events_active_page_idx ON public.community_events USING btree (community_id, end_date, event_date, id);

CREATE INDEX community_events_community_event_date_id_idx ON public.community_events USING btree (community_id, event_date, id);

CREATE INDEX community_events_community_event_id_idx ON public.community_events USING btree (community_id, event_date, id);

CREATE INDEX idx_community_events_community_created ON public.community_events USING btree (community_id, created_at DESC);

CREATE INDEX idx_community_events_community_date ON public.community_events USING btree (community_id, event_date);

CREATE INDEX idx_community_events_lifecycle_end ON public.community_events USING btree (end_date) WHERE (end_date IS NOT NULL);

CREATE INDEX idx_community_events_lifecycle_start ON public.community_events USING btree (event_date);

CREATE INDEX idx_community_events_user ON public.community_events USING btree (user_id);

CREATE INDEX idx_community_events_user_created ON public.community_events USING btree (user_id, created_at DESC);

CREATE INDEX idx_community_join_requests_community_status ON public.community_join_requests USING btree (community_id, status, requested_at DESC);

CREATE INDEX idx_community_members_joined_at ON public.community_members USING btree (community_id, joined_at, user_id);

CREATE INDEX idx_community_members_page ON public.community_members USING btree (community_id, (
CASE role
    WHEN 'owner'::text THEN 0
    WHEN 'admin'::text THEN 1
    ELSE 2
END), joined_at, user_id);

CREATE INDEX idx_community_members_role ON public.community_members USING btree (community_id, role);

CREATE INDEX idx_community_members_user_archive ON public.community_members USING btree (user_id, archived_at);

CREATE INDEX idx_community_members_user_community ON public.community_members USING btree (user_id, community_id);

CREATE INDEX community_messages_pending_image_moderation_idx ON public.community_messages USING btree (created_at) WHERE (image_status = 'pending'::text);

CREATE INDEX idx_community_messages_community_created ON public.community_messages USING btree (community_id, created_at DESC);

CREATE INDEX idx_community_messages_created_at ON public.community_messages USING btree (created_at);

CREATE INDEX idx_community_messages_reply_to_content ON public.community_messages USING btree (reply_to_content_id) WHERE (reply_to_content_id IS NOT NULL);

CREATE INDEX idx_community_messages_reply_to_id ON public.community_messages USING btree (reply_to_id) WHERE (reply_to_id IS NOT NULL);

CREATE INDEX idx_community_messages_room_time ON public.community_messages USING btree (community_id, created_at);

CREATE INDEX idx_community_messages_room_time_id ON public.community_messages USING btree (community_id, created_at, id);

CREATE INDEX idx_community_messages_room_unread ON public.community_messages USING btree (community_id, user_id, created_at);

CREATE INDEX community_resources_community_created_id_idx ON public.community_resources USING btree (community_id, created_at DESC, id DESC);

CREATE INDEX idx_community_resources_community_time ON public.community_resources USING btree (community_id, created_at DESC);

CREATE INDEX idx_community_resources_user_time ON public.community_resources USING btree (user_id, created_at DESC);

CREATE INDEX idx_community_rules_community_order ON public.community_rules USING btree (community_id, order_index);

CREATE INDEX community_showcase_posts_community_created_id_idx ON public.community_showcase_posts USING btree (community_id, created_at DESC, id DESC);

CREATE INDEX idx_community_showcase_posts_public_created ON public.community_showcase_posts USING btree (created_at DESC) WHERE (is_public = true);

CREATE INDEX idx_community_showcase_posts_user_created ON public.community_showcase_posts USING btree (user_id, created_at DESC);

CREATE INDEX showcase_posts_community_category_idx ON public.community_showcase_posts USING btree (community_id, category, created_at DESC);

CREATE INDEX showcase_posts_community_created_idx ON public.community_showcase_posts USING btree (community_id, created_at DESC);

CREATE INDEX community_threads_community_created_id_idx ON public.community_threads USING btree (community_id, created_at DESC, id DESC);

CREATE INDEX idx_community_threads_community_time ON public.community_threads USING btree (community_id, created_at DESC);

CREATE INDEX idx_community_threads_public_home_created ON public.community_threads USING btree (created_at DESC, id DESC) WHERE ((is_public = true) AND (community_id IS NOT NULL));

CREATE INDEX idx_community_threads_public_time ON public.community_threads USING btree (created_at DESC) WHERE (is_public = true);

CREATE INDEX idx_community_threads_user_time ON public.community_threads USING btree (user_id, created_at DESC);

CREATE INDEX companies_active_name_idx ON public.companies USING btree (is_active, name);

CREATE INDEX companies_featured_rank_idx ON public.companies USING btree (featured_rank) WHERE (featured_rank IS NOT NULL);

CREATE INDEX companies_name_lower_prefix_idx ON public.companies USING btree (lower(name) text_pattern_ops);

CREATE INDEX companies_name_trgm_idx ON public.companies USING gin (name extensions.gin_trgm_ops);

CREATE INDEX companies_slug_trgm_idx ON public.companies USING gin (slug extensions.gin_trgm_ops);

CREATE UNIQUE INDEX companies_source_identity_idx ON public.companies USING btree (source, source_id) WHERE (source_id IS NOT NULL);

CREATE INDEX idx_companies_name ON public.companies USING btree (lower(name));

CREATE INDEX company_aliases_alias_trgm_idx ON public.company_aliases USING gin (alias extensions.gin_trgm_ops);

CREATE INDEX company_aliases_company_idx ON public.company_aliases USING btree (company_id);

CREATE UNIQUE INDEX company_directory_seed_retired_slug_idx ON public.company_directory_seed_retired USING btree (slug);

CREATE INDEX company_domain_reviews_company_idx ON public.company_domain_reviews USING btree (company_id, created_at DESC);

CREATE INDEX company_domain_reviews_domain_idx ON public.company_domain_reviews USING btree (domain, created_at DESC);

CREATE INDEX company_domain_reviews_reviewer_idx ON public.company_domain_reviews USING btree (reviewer_id, created_at DESC);

CREATE INDEX company_domains_domain_idx ON public.company_domains USING btree (domain);

CREATE INDEX company_domains_domain_prefix_idx ON public.company_domains USING btree (domain text_pattern_ops);

CREATE UNIQUE INDEX company_domains_verified_domain_idx ON public.company_domains USING btree (domain) WHERE verified;

CREATE INDEX idx_company_domains_company ON public.company_domains USING btree (company_id);

CREATE INDEX idx_company_domains_domain_lookup ON public.company_domains USING btree (domain);

CREATE INDEX idx_company_email_verifications_domain ON public.company_email_verifications USING btree (domain) WHERE (consumed_at IS NULL);

CREATE INDEX idx_company_email_verifications_user ON public.company_email_verifications USING btree (user_id) WHERE (consumed_at IS NULL);

CREATE INDEX idx_company_members_company ON public.company_members USING btree (company_id);

CREATE INDEX idx_company_members_user ON public.company_members USING btree (user_id);

CREATE INDEX company_relationships_child_idx ON public.company_relationships USING btree (child_company_id);

CREATE INDEX company_relationships_parent_idx ON public.company_relationships USING btree (parent_company_id);

CREATE INDEX idx_content_reactions_community ON public.content_reactions USING btree (community_id);

CREATE INDEX idx_content_reactions_community_created ON public.content_reactions USING btree (community_id, created_at DESC);

CREATE INDEX idx_content_reactions_content ON public.content_reactions USING btree (content_id, content_kind);

CREATE INDEX idx_content_removals_active ON public.content_removals USING btree (content_type, content_id) WHERE (undone_at IS NULL);

CREATE INDEX idx_content_removals_content ON public.content_removals USING btree (content_type, content_id, removed_at DESC);

CREATE UNIQUE INDEX content_reports_pending_unique ON public.content_reports USING btree (reporter_id, content_type, content_id) WHERE (status = 'pending'::text);

CREATE INDEX idx_content_reports_content ON public.content_reports USING btree (content_type, content_id);

CREATE INDEX idx_content_reports_status_created ON public.content_reports USING btree (status, created_at DESC);

CREATE INDEX idx_profiles_city ON public.designer_profiles USING btree (city_id);

CREATE INDEX idx_profiles_company ON public.designer_profiles USING btree (company_id);

CREATE INDEX idx_profiles_job_title ON public.designer_profiles USING btree (job_title);

CREATE INDEX idx_profiles_sector ON public.designer_profiles USING btree (sector_id);

CREATE INDEX idx_dm_conversations_user_a ON public.dm_conversations USING btree (user_a, last_message_at DESC NULLS LAST);

CREATE INDEX idx_dm_conversations_user_b ON public.dm_conversations USING btree (user_b, last_message_at DESC NULLS LAST);

CREATE INDEX idx_dm_message_reactions_conversation_time ON public.dm_message_reactions USING btree (conversation_id, created_at DESC);

CREATE INDEX idx_dm_messages_conversation_time ON public.dm_messages USING btree (conversation_id, created_at, id);

CREATE INDEX idx_dm_messages_reply_to ON public.dm_messages USING btree (reply_to_id) WHERE (reply_to_id IS NOT NULL);

CREATE UNIQUE INDEX idx_dm_messages_sender_nonce ON public.dm_messages USING btree (user_id, client_nonce);

CREATE UNIQUE INDEX dm_reports_pending_unique ON public.dm_reports USING btree (reporter_id, reported_user_id) WHERE (status = 'pending'::text);

CREATE INDEX idx_dm_reports_status_created ON public.dm_reports USING btree (status, created_at DESC);

CREATE INDEX domain_evidence_company_idx ON public.domain_evidence USING btree (company_id);

CREATE INDEX domain_evidence_domain_idx ON public.domain_evidence USING btree (domain);

CREATE UNIQUE INDEX domain_evidence_domain_key ON public.domain_evidence USING btree (company_id, domain, evidence_type, COALESCE(source_url, ''::text));

CREATE INDEX idx_event_chat_join_responses_community ON public.event_chat_join_responses USING btree (community_id);

CREATE INDEX event_comment_reactions_lookup ON public.event_comment_reactions USING btree (comment_id);

CREATE INDEX idx_event_comments_event ON public.event_comments USING btree (event_id, created_at);

CREATE INDEX idx_event_comments_parent ON public.event_comments USING btree (parent_id) WHERE (parent_id IS NOT NULL);

CREATE INDEX idx_event_comments_user ON public.event_comments USING btree (user_id);

CREATE INDEX event_likes_event_idx ON public.event_likes USING btree (event_id);

CREATE INDEX event_likes_user_created_idx ON public.event_likes USING btree (user_id, created_at DESC);

CREATE INDEX idx_event_rsvps_event ON public.event_rsvps USING btree (event_id);

CREATE INDEX event_saves_event_idx ON public.event_saves USING btree (event_id);

CREATE INDEX event_saves_user_created_idx ON public.event_saves USING btree (user_id, created_at DESC);

CREATE INDEX idx_event_saves_event ON public.event_saves USING btree (event_id);

CREATE INDEX idx_event_saves_user ON public.event_saves USING btree (user_id, created_at DESC);

CREATE INDEX idx_fcm_tokens_user ON public.fcm_tokens USING btree (user_id);

CREATE INDEX idx_interaction_reports_reason_created ON public.interaction_reports USING btree (reason, created_at DESC);

CREATE INDEX idx_interaction_reports_status_created ON public.interaction_reports USING btree (status, created_at DESC);

CREATE INDEX idx_interaction_reports_target ON public.interaction_reports USING btree (target_type, target_id);

CREATE INDEX idx_interaction_reports_type_status_created ON public.interaction_reports USING btree (target_type, status, created_at DESC);

CREATE UNIQUE INDEX interaction_reports_pending_unique ON public.interaction_reports USING btree (reporter_id, target_type, target_id) WHERE (status = 'pending'::text);

CREATE INDEX idx_invitations_token ON public.invitations USING btree (token);

CREATE INDEX idx_job_applications_applicant ON public.job_applications USING btree (applicant_id);

CREATE INDEX idx_job_applications_job ON public.job_applications USING btree (job_id, created_at DESC);

CREATE INDEX idx_job_posts_company ON public.job_posts USING btree (company_id);

CREATE INDEX idx_job_posts_created ON public.job_posts USING btree (created_at DESC, id DESC);

CREATE INDEX idx_job_posts_moderated ON public.job_posts USING btree (moderated_at DESC) WHERE (moderated_at IS NOT NULL);

CREATE INDEX idx_job_posts_poster ON public.job_posts USING btree (poster_id);

CREATE INDEX idx_job_posts_status ON public.job_posts USING btree (status);

CREATE INDEX idx_library_items_kind_rank ON public.library_items USING btree (item_type, featured_rank);

CREATE UNIQUE INDEX member_resumes_one_default_per_user_idx ON public.member_resumes USING btree (user_id) WHERE is_default;

CREATE INDEX member_resumes_user_id_idx ON public.member_resumes USING btree (user_id);

CREATE INDEX idx_message_reactions_community_created ON public.message_reactions USING btree (community_id, created_at DESC);

CREATE INDEX idx_message_reactions_community_id ON public.message_reactions USING btree (community_id);

CREATE INDEX idx_message_reactions_message_id ON public.message_reactions USING btree (message_id);

CREATE INDEX idx_moderation_appeals_status_created ON public.moderation_appeals USING btree (status, created_at DESC);

CREATE INDEX idx_moderation_appeals_user_created ON public.moderation_appeals USING btree (user_id, created_at DESC);

CREATE UNIQUE INDEX moderation_appeals_report_unique ON public.moderation_appeals USING btree (report_id);

CREATE INDEX idx_moderation_audit_created ON public.moderation_audit_log USING btree (created_at DESC);

CREATE INDEX idx_moderation_audit_report ON public.moderation_audit_log USING btree (report_id);

CREATE INDEX idx_moderation_audit_target ON public.moderation_audit_log USING btree (target_type, target_id, created_at DESC);

CREATE INDEX idx_audit_log_created_legacy_20261030 ON public.moderation_audit_log_legacy_20261030 USING btree (created_at DESC);

CREATE INDEX idx_audit_log_moderator_legacy_20261030 ON public.moderation_audit_log_legacy_20261030 USING btree (moderator_email);

CREATE INDEX idx_moderation_logs_content_id ON public.moderation_logs USING btree (content_id);

CREATE INDEX idx_moderation_logs_content_type ON public.moderation_logs USING btree (content_type);

CREATE INDEX idx_moderation_logs_created_at ON public.moderation_logs USING btree (created_at DESC);

CREATE INDEX idx_moderation_logs_user_id ON public.moderation_logs USING btree (user_id);

CREATE INDEX idx_notifications_entity ON public.notifications USING btree (entity_type, entity_id);

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);

CREATE UNIQUE INDEX idx_notifications_user_entity_unread ON public.notifications USING btree (user_id, entity_type, entity_id) WHERE (read_at IS NULL);

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);

CREATE INDEX idx_password_resets_token ON public.password_resets USING btree (token);

CREATE INDEX push_throttle_window_idx ON public.push_throttle USING btree (window_started_at);

CREATE INDEX push_tokens_user_id_idx ON public.push_tokens USING btree (user_id);

CREATE INDEX idx_resource_bookmarks_user ON public.resource_bookmarks USING btree (user_id, created_at DESC);

CREATE INDEX resource_comment_reactions_lookup ON public.resource_comment_reactions USING btree (comment_id);

CREATE INDEX idx_resource_comments_parent ON public.resource_comments USING btree (parent_id);

CREATE INDEX idx_resource_comments_resource_time ON public.resource_comments USING btree (resource_id, created_at);

CREATE INDEX idx_resource_comments_user ON public.resource_comments USING btree (user_id);

CREATE INDEX idx_resource_saves_user ON public.resource_saves USING btree (user_id, created_at DESC);

CREATE INDEX showcase_comment_reactions_lookup ON public.showcase_comment_reactions USING btree (comment_id);

CREATE INDEX showcase_comments_parent_idx ON public.showcase_comments USING btree (parent_id) WHERE (parent_id IS NOT NULL);

CREATE INDEX showcase_comments_post_created_idx ON public.showcase_comments USING btree (post_id, created_at);

CREATE INDEX showcase_likes_post_idx ON public.showcase_likes USING btree (post_id);

CREATE INDEX showcase_saves_post_idx ON public.showcase_saves USING btree (post_id);

CREATE INDEX showcase_saves_user_idx ON public.showcase_saves USING btree (user_id, created_at DESC);

CREATE UNIQUE INDEX idx_signup_attempts_resume_token ON public.signup_attempts USING btree (resume_token) WHERE (resume_token IS NOT NULL);

CREATE INDEX idx_signup_attempts_status_started ON public.signup_attempts USING btree (status, started_at DESC);

CREATE INDEX thread_comment_reactions_lookup ON public.thread_comment_reactions USING btree (comment_id);

CREATE INDEX idx_thread_comments_parent ON public.thread_comments USING btree (parent_id) WHERE (parent_id IS NOT NULL);

CREATE INDEX idx_thread_comments_thread ON public.thread_comments USING btree (thread_id, created_at);

CREATE INDEX idx_thread_comments_user ON public.thread_comments USING btree (user_id);

CREATE INDEX idx_thread_likes_thread ON public.thread_likes USING btree (thread_id);

CREATE INDEX idx_thread_likes_user ON public.thread_likes USING btree (user_id);

CREATE INDEX idx_thread_poll_votes_thread ON public.thread_poll_votes USING btree (thread_id, option_index);

CREATE INDEX idx_thread_saves_thread ON public.thread_saves USING btree (thread_id);

CREATE INDEX idx_thread_saves_user ON public.thread_saves USING btree (user_id);

CREATE INDEX thread_saves_thread_id_idx ON public.thread_saves USING btree (thread_id);

CREATE INDEX thread_saves_user_id_idx ON public.thread_saves USING btree (user_id);

CREATE INDEX idx_user_blocks_blocked ON public.user_blocks USING btree (blocked_id);

CREATE INDEX idx_punishments_expires_at ON public.user_punishments USING btree (expires_at);

CREATE INDEX idx_punishments_type ON public.user_punishments USING btree (type);

CREATE INDEX idx_punishments_user_id ON public.user_punishments USING btree (user_id);

CREATE INDEX idx_users_email ON public.users USING btree (email);

CREATE INDEX idx_users_is_blocked ON public.users USING btree (is_blocked);

CREATE INDEX idx_users_suspended_until ON public.users USING btree (suspended_until) WHERE (suspended_until IS NOT NULL);

CREATE INDEX idx_users_verification_status ON public.users USING btree (verification_status);

CREATE OR REPLACE FUNCTION public.admin_create_company(p_name text, p_domain text DEFAULT NULL::text, p_logo_url text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, slug text, logo_url text, is_active boolean, domain text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name            text := nullif(btrim(coalesce(p_name, '')), '');
  v_domain          text := nullif(lower(btrim(coalesce(p_domain, ''))), '');
  v_slug_base       text;
  v_slug            text;
  v_suffix          integer := 1;
  v_company_id      uuid;
  v_existing_id     uuid;
  v_existing_active boolean;
  v_owner_id        uuid;
  v_owner_name      text;
begin
  if v_name is null or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'company_name_required';
  end if;

  if v_domain is not null
     and v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  -- A name already in the directory has to be edited, not duplicated. Detail
  -- carries the row and whether it is inactive, so the page can offer to
  -- reactivate it instead of failing flatly.
  select c.id, c.is_active into v_existing_id, v_existing_active
  from public.companies as c
  where lower(btrim(c.name)) = lower(v_name)
  limit 1;

  if v_existing_id is not null then
    raise exception using errcode = 'P0001', message = 'company_name_taken',
      detail = jsonb_build_object(
        'company_id', v_existing_id,
        'is_active', v_existing_active
      )::text;
  end if;

  -- A domain may belong to only one company, proved or hinted. Refuse rather
  -- than create a competing row, and name the owner so the page can say who.
  if v_domain is not null then
    select d.company_id, c.name into v_owner_id, v_owner_name
    from public.company_domains as d
    join public.companies as c on c.id = d.company_id
    where d.domain = v_domain
    order by d.verified desc, d.created_at asc
    limit 1;
  end if;

  if v_owner_id is not null then
    raise exception using errcode = 'P0001', message = 'domain_taken',
      detail = jsonb_build_object(
        'company_id', v_owner_id,
        'company_name', v_owner_name
      )::text;
  end if;

  v_slug_base := left(public.company_slugify(v_name), 48);
  v_slug := v_slug_base;
  while exists (select 1 from public.companies as c where c.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  insert into public.companies (name, slug, logo_url, source, entity_status)
  values (v_name, v_slug, nullif(btrim(coalesce(p_logo_url, '')), ''), 'admin', 'active')
  returning public.companies.id into v_company_id;

  -- An operator prepares a hint; `verified` stays false. The first member whose
  -- work email matches finishes the claim through the ordinary OTP flow.
  if v_domain is not null then
    insert into public.company_domains (
      company_id, domain, verified, domain_type, evidence_confidence, source
    ) values (
      v_company_id, v_domain, false, 'primary_website', 'unknown', 'admin'
    );
  end if;

  return query
  select c.id, c.name, c.slug, c.logo_url, c.is_active, v_domain
  from public.companies as c
  where c.id = v_company_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_company(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found uuid;
begin
  select c.id into v_found from public.companies as c where c.id = p_id;
  if v_found is null then
    return false;
  end if;

  delete from public.companies as c where c.id = p_id;

  -- The delete cascades the domains, memberships and challenges, and would
  -- leave the position it held empty; renumber the block that is left.
  perform public.company_featured_renumber();

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_featured_companies()
 RETURNS TABLE("position" integer, id uuid, name text, slug text, logo_url text, domain text, domain_verified boolean, member_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    c.featured_rank as position,
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    dom.domain,
    coalesce(dom.verified, false) as domain_verified,
    (select count(*)::bigint from public.company_members as m
      where m.company_id = c.id and m.verified) as member_count
  from public.companies as c
  -- The same primary-domain rule as admin_list_companies and the picker's
  -- search: a proved domain first, then the oldest hint.
  left join lateral (
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as dom on true
  where c.featured_rank is not null
  order by c.featured_rank asc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_join_all_communities(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total integer;
begin
  perform set_config('app.bypass_creation_limits', 'on', true);

  insert into public.community_members (community_id, user_id)
  select c.id, p_user_id
    from public.communities as c
  on conflict (community_id, user_id) do nothing;

  select count(*) into v_total
    from public.community_members as m
   where m.user_id = p_user_id;

  return v_total;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_library_candidates(p_kind text, p_search text DEFAULT ''::text, p_sort text DEFAULT 'engagement'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid, title text, category text, community_name text, author_name text, is_public boolean, created_at timestamp with time zone, like_count bigint, comment_count bigint, featured boolean, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with candidates as (
    select 'thread'::text as kind, t.id, t.title, t.category,
           c.name as community_name, u.name as author_name, t.is_public, t.created_at,
           (select count(*) from public.thread_likes as x where x.thread_id = t.id) as like_count,
           (select count(*) from public.thread_comments as x where x.thread_id = t.id) as comment_count,
           (li.id is not null) as featured
    from public.community_threads as t
    left join public.communities as c on c.id = t.community_id
    left join public.users as u on u.id = t.user_id
    left join public.library_items as li on li.thread_id = t.id
    where p_kind = 'thread'
      and t.community_id is not null
      and (coalesce(p_search, '') = ''
           or t.title ilike '%' || p_search || '%'
           or coalesce(u.name, '') ilike '%' || p_search || '%')
    union all
    select 'showcase', s.id, s.title, s.category,
           c.name, u.name, s.is_public, s.created_at,
           (select count(*) from public.showcase_likes as x where x.post_id = s.id),
           (select count(*) from public.showcase_comments as x where x.post_id = s.id),
           (li.id is not null)
    from public.community_showcase_posts as s
    left join public.communities as c on c.id = s.community_id
    left join public.users as u on u.id = s.user_id
    left join public.library_items as li on li.showcase_id = s.id
    where p_kind = 'showcase'
      and s.community_id is not null
      and (coalesce(p_search, '') = ''
           or s.title ilike '%' || p_search || '%'
           or coalesce(u.name, '') ilike '%' || p_search || '%')
    union all
    select 'resource', r.id, r.title, r.resource_type,
           c.name, u.name, r.is_public, r.created_at,
           (select count(*) from public.resource_saves as x where x.resource_id = r.id),
           (select count(*) from public.resource_comments as x where x.resource_id = r.id),
           (li.id is not null)
    from public.community_resources as r
    left join public.communities as c on c.id = r.community_id
    left join public.users as u on u.id = r.user_id
    left join public.library_items as li on li.resource_id = r.id
    where p_kind = 'resource'
      and r.community_id is not null
      and (coalesce(p_search, '') = ''
           or r.title ilike '%' || p_search || '%'
           or coalesce(u.name, '') ilike '%' || p_search || '%')
  ),
  ranked as (
    select candidates.*, count(*) over () as total_count
    from candidates
  )
  select id, title, category, community_name, author_name, is_public, created_at,
         like_count, comment_count, featured, total_count
  from ranked
  order by
    case when p_sort = 'newest' then created_at end desc nulls last,
    like_count + comment_count desc,
    created_at desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$function$;

CREATE OR REPLACE FUNCTION public.admin_library_featured()
 RETURNS TABLE(item_type text, item_id uuid, "position" integer, title text, category text, community_name text, author_name text, is_public boolean, like_count bigint, comment_count bigint, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'thread'::text, t.id, li.featured_rank, t.title, t.category,
         c.name, u.name, t.is_public,
         (select count(*) from public.thread_likes as x where x.thread_id = t.id),
         (select count(*) from public.thread_comments as x where x.thread_id = t.id),
         t.created_at
  from public.library_items as li
  join public.community_threads as t on t.id = li.thread_id
  left join public.communities as c on c.id = t.community_id
  left join public.users as u on u.id = t.user_id
  union all
  select 'showcase', s.id, li.featured_rank, s.title, s.category,
         c.name, u.name, s.is_public,
         (select count(*) from public.showcase_likes as x where x.post_id = s.id),
         (select count(*) from public.showcase_comments as x where x.post_id = s.id),
         s.created_at
  from public.library_items as li
  join public.community_showcase_posts as s on s.id = li.showcase_id
  left join public.communities as c on c.id = s.community_id
  left join public.users as u on u.id = s.user_id
  union all
  select 'resource', r.id, li.featured_rank, r.title, r.resource_type,
         c.name, u.name, r.is_public,
         (select count(*) from public.resource_saves as x where x.resource_id = r.id),
         (select count(*) from public.resource_comments as x where x.resource_id = r.id),
         r.created_at
  from public.library_items as li
  join public.community_resources as r on r.id = li.resource_id
  left join public.communities as c on c.id = r.community_id
  left join public.users as u on u.id = r.user_id
  order by 1 asc, 3 asc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_companies(p_query text DEFAULT ''::text, p_all boolean DEFAULT false, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, slug text, logo_url text, is_active boolean, created_at timestamp with time zone, domain text, domain_verified boolean, domain_count integer, member_count bigint, total_count bigint, featured_rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with filtered as (
    select
      c.id,
      c.name,
      c.slug,
      c.logo_url,
      c.is_active,
      c.created_at,
      c.featured_rank,
      (select count(*)::integer from public.company_domains as d
        where d.company_id = c.id) as domain_count,
      (select count(*)::bigint from public.company_members as m
        where m.company_id = c.id and m.verified) as member_count
    from public.companies as c
    where (p_all or c.is_active)
      and (
        btrim(coalesce(p_query, '')) = ''
        or c.name ilike '%' || public.company_search_term(p_query) || '%' escape '\'
        or c.slug ilike '%' || lower(public.company_search_term(p_query)) || '%' escape '\'
      )
  )
  select
    f.id,
    f.name,
    f.slug,
    f.logo_url,
    f.is_active,
    f.created_at,
    dom.domain,
    coalesce(dom.verified, false) as domain_verified,
    f.domain_count,
    f.member_count,
    count(*) over() as total_count,
    f.featured_rank
  from filtered as f
  -- The primary domain: a proved one first, then the oldest hint. This is the
  -- same order the picker's search uses, so a row reads the same in both places.
  left join lateral (
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = f.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as dom on true
  order by f.name asc
  -- 1,000 rather than 500: the page filters client-side, and the curated
  -- directory alone is 573 rows, so a directory row past the cap was invisible
  -- in the admin page — including to whoever wanted to feature it.
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public.admin_move_company_featured(p_id uuid, p_direction integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rank       integer;
  v_neighbour  uuid;
  v_their_rank integer;
begin
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception using errcode = '22023', message = 'invalid_direction';
  end if;

  select c.featured_rank into v_rank
  from public.companies as c
  where c.id = p_id;

  if v_rank is null then
    if not exists (select 1 from public.companies as c where c.id = p_id) then
      raise exception using errcode = 'P0002', message = 'company_not_found';
    end if;
    raise exception using errcode = 'P0001', message = 'company_not_featured';
  end if;

  -- The neighbour is a POSITION away, not a rank away: ranks are 1..N while
  -- company_featured_renumber() has run, but the block is defined by its order,
  -- and a swap of two ranks keeps that order whatever the gaps are.
  with ordered as (
    select
      c.id,
      c.featured_rank as rank,
      row_number() over (order by c.featured_rank asc, c.name asc, c.id asc) as position
    from public.companies as c
    where c.featured_rank is not null
  )
  select n.id, n.rank
    into v_neighbour, v_their_rank
  from ordered as m
  join ordered as n on n.position = m.position + p_direction
  where m.id = p_id;

  if v_neighbour is null then
    return v_rank;
  end if;

  -- `featured_rank` carries no unique index, so the intermediate duplicate is
  -- allowed and the two statements cannot deadlock against themselves.
  update public.companies as c set featured_rank = v_their_rank where c.id = p_id;
  update public.companies as c set featured_rank = v_rank where c.id = v_neighbour;

  return v_their_rank;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_move_library_item(p_type text, p_id uuid, p_direction integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item_id    uuid;
  v_rank       integer;
  v_neighbour  uuid;
  v_their_rank integer;
begin
  if p_type is null or p_type not in ('thread', 'showcase', 'resource') then
    raise exception using errcode = '22023', message = 'invalid_type';
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception using errcode = '22023', message = 'invalid_direction';
  end if;

  select li.id, li.featured_rank
    into v_item_id, v_rank
  from public.library_items as li
  where li.item_type = p_type
    and p_id in (li.thread_id, li.showcase_id, li.resource_id);

  if v_rank is null then
    -- Distinguish "not a post" from "not on the shelf" for the route's message.
    if not exists (
      select 1 from public.community_threads as t        where p_type = 'thread'   and t.id = p_id
      union all
      select 1 from public.community_showcase_posts as s where p_type = 'showcase' and s.id = p_id
      union all
      select 1 from public.community_resources as r      where p_type = 'resource' and r.id = p_id
    ) then
      raise exception using errcode = 'P0002', message = 'item_not_found';
    end if;
    raise exception using errcode = 'P0001', message = 'item_not_featured';
  end if;

  -- The neighbour is a POSITION away, not a rank away: ranks are 1..N while
  -- library_featured_renumber() has run, but the block is defined by its
  -- order, and a swap of two ranks keeps that order whatever the gaps are.
  with ordered as (
    select
      li.id,
      li.featured_rank as rank,
      row_number() over (order by li.featured_rank asc, li.curated_at asc, li.id asc) as position
    from public.library_items as li
    where li.item_type = p_type
  )
  select n.id, n.rank
    into v_neighbour, v_their_rank
  from ordered as m
  join ordered as n on n.position = m.position + p_direction
  where m.id = v_item_id;

  if v_neighbour is null then
    return v_rank;
  end if;

  -- No unique index on (item_type, featured_rank), so the intermediate
  -- duplicate is allowed and the two statements cannot deadlock themselves.
  update public.library_items as li set featured_rank = v_their_rank where li.id = v_item_id;
  update public.library_items as li set featured_rank = v_rank       where li.id = v_neighbour;

  return v_their_rank;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_company_featured(p_id uuid, p_featured boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_is_active boolean;
  v_rank      integer;
begin
  if p_featured is null then
    raise exception using errcode = '22023', message = 'featured_required';
  end if;

  select c.is_active, c.featured_rank
    into v_is_active, v_rank
  from public.companies as c
  where c.id = p_id;

  -- `is_active` is NOT NULL, so a null here means no row.
  if v_is_active is null then
    raise exception using errcode = 'P0002', message = 'company_not_found';
  end if;

  if p_featured then
    if not v_is_active then
      raise exception using errcode = 'P0001', message = 'company_inactive',
        hint = 'activate the company first: a hidden company cannot lead the picker';
    end if;

    if v_rank is null then
      select coalesce(max(c.featured_rank), 0) + 1
        into v_rank
      from public.companies as c
      where c.featured_rank is not null;

      update public.companies as c set featured_rank = v_rank where c.id = p_id;
    end if;

    return v_rank;
  end if;

  if v_rank is not null then
    update public.companies as c set featured_rank = null where c.id = p_id;
    perform public.company_featured_renumber();
  end if;

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_library_item(p_type text, p_id uuid, p_featured boolean, p_curated_by uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_exists boolean;
  v_rank   integer;
begin
  if p_type is null or p_type not in ('thread', 'showcase', 'resource') then
    raise exception using errcode = '22023', message = 'invalid_type';
  end if;
  if p_featured is null then
    raise exception using errcode = '22023', message = 'featured_required';
  end if;

  select case p_type
           when 'thread'   then exists (select 1 from public.community_threads as t where t.id = p_id)
           when 'showcase' then exists (select 1 from public.community_showcase_posts as s where s.id = p_id)
           else                 exists (select 1 from public.community_resources as r where r.id = p_id)
         end
    into v_exists;

  if not v_exists then
    raise exception using errcode = 'P0002', message = 'item_not_found';
  end if;

  if not p_featured then
    delete from public.library_items as li
    where li.item_type = p_type
      and p_id in (li.thread_id, li.showcase_id, li.resource_id);
    perform public.library_featured_renumber(p_type);
    return null;
  end if;

  select li.featured_rank
    into v_rank
  from public.library_items as li
  where li.item_type = p_type
    and p_id in (li.thread_id, li.showcase_id, li.resource_id);

  if v_rank is null then
    select coalesce(max(li.featured_rank), 0) + 1
      into v_rank
    from public.library_items as li
    where li.item_type = p_type;

    insert into public.library_items
      (thread_id, showcase_id, resource_id, featured_rank, curated_by)
    values
      (case when p_type = 'thread' then p_id end,
       case when p_type = 'showcase' then p_id end,
       case when p_type = 'resource' then p_id end,
       v_rank,
       p_curated_by);
  end if;

  return v_rank;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_company(p_id uuid, p_name text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean, p_logo_url text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, slug text, logo_url text, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name     text := nullif(btrim(coalesce(p_name, '')), '');
  v_existing uuid;
begin
  if not exists (select 1 from public.companies as c where c.id = p_id) then
    raise exception using errcode = 'P0002', message = 'company_not_found';
  end if;

  if p_name is not null then
    if v_name is null or char_length(v_name) > 120 then
      raise exception using errcode = '22023', message = 'company_name_required';
    end if;

    select c.id into v_existing
    from public.companies as c
    where lower(btrim(c.name)) = lower(v_name) and c.id <> p_id
    limit 1;

    if v_existing is not null then
      raise exception using errcode = 'P0001', message = 'company_name_taken';
    end if;
  end if;

  update public.companies as c
  set name      = coalesce(v_name, c.name),
      is_active = coalesce(p_is_active, c.is_active),
      logo_url  = coalesce(nullif(btrim(coalesce(p_logo_url, '')), ''), c.logo_url),
      -- A hidden company cannot lead the picker, and the check constraint says
      -- so: the position is cleared in the same statement as the deactivation,
      -- and the block closes the gap below.
      featured_rank = case
        when coalesce(p_is_active, c.is_active) then c.featured_rank
        else null
      end
  where c.id = p_id;

  perform public.company_featured_renumber();

  return query
  select c.id, c.name, c.slug, c.logo_url, c.is_active
  from public.companies as c
  where c.id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.anonymize_deleted_user_reports()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.interaction_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.content_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.dm_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.moderation_appeals
     set user_id = null,
         user_deleted_at = coalesce(user_deleted_at, now())
   where user_id = old.id;

  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_to_job(p_job_id uuid, p_applicant_id uuid, p_name text, p_portfolio_url text, p_linkedin_url text, p_resume_url text DEFAULT NULL::text)
 RETURNS TABLE(application_id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job        public.job_posts%rowtype;
  v_name       text := btrim(coalesce(p_name, ''));
  v_portfolio  text := btrim(coalesce(p_portfolio_url, ''));
  v_linkedin   text := btrim(coalesce(p_linkedin_url, ''));
  v_resume     text := nullif(btrim(coalesce(p_resume_url, '')), '');
begin
  select * into v_job from public.job_posts as jp where jp.id = p_job_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'job_not_found';
  end if;

  if p_applicant_id is null
     or not exists (select 1 from public.users as u where u.id = p_applicant_id) then
    raise exception using errcode = '23503', message = 'unknown_user';
  end if;

  if v_job.poster_id = p_applicant_id then
    raise exception using errcode = 'P0001', message = 'own_job';
  end if;

  -- One gate, read from the shared rule, with the reason named for the member
  -- reading it: the owner ended the posting, or its deadline passed.
  if not public.job_post_is_open(v_job.status, v_job.closes_at) then
    if v_job.status <> 'open' then
      raise exception using errcode = 'P0001', message = 'job_closed';
    end if;
    raise exception using errcode = 'P0001', message = 'job_expired';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;

  if v_portfolio !~* '^https?://' then
    raise exception using errcode = '22023', message = 'invalid_portfolio_url';
  end if;

  if v_linkedin !~* '^https?://'
     or position('linkedin.com' in lower(v_linkedin)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_linkedin_url';
  end if;

  if v_resume is not null and v_resume !~* '^https?://' then
    raise exception using errcode = '22023', message = 'invalid_resume_url';
  end if;

  -- The gate: the applicant's OWN profile must match the posting —
  -- job title and experience level exactly, and city and sector
  -- unless the posting set them to All (NULL, which matches
  -- everyone). Read from the profile row — never from the request —
  -- so a crafted call cannot widen eligibility.
  if not exists (
    select 1 from public.designer_profiles as dp
    where dp.user_id = p_applicant_id
      and (v_job.city_id is null or dp.city_id = v_job.city_id)
      and (v_job.sector_id is null or dp.sector_id = v_job.sector_id)
      and dp.job_title = v_job.job_title
      and dp.experience_level = v_job.experience_level
  ) then
    raise exception using errcode = 'P0001', message = 'not_eligible';
  end if;

  if exists (
    select 1 from public.job_applications as ja
    where ja.job_id = p_job_id and ja.applicant_id = p_applicant_id
  ) then
    raise exception using errcode = 'P0001', message = 'already_applied';
  end if;

  begin
    return query
    insert into public.job_applications as ja (
      job_id, applicant_id, name, portfolio_url, linkedin_url, resume_url
    )
    values (
      p_job_id, p_applicant_id, v_name, v_portfolio, v_linkedin, v_resume
    )
    returning ja.id, ja.created_at;
  exception
    -- Two concurrent submissions: the unique constraint is the rule,
    -- the check above is only the friendlier error.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'already_applied';
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_to_job_with_resume(p_job_id uuid, p_applicant_id uuid, p_name text, p_portfolio_url text, p_linkedin_url text, p_resume_key text)
 RETURNS TABLE(application_id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_application_id uuid;
  v_created_at timestamptz;
  v_updated integer;
begin
  if p_resume_key is null
     or p_resume_key not like 'resumes/%'
     or p_resume_key like '%..%'
     or p_resume_key like 'http%' then
    raise exception using errcode = '22023', message = 'invalid_resume_key';
  end if;

  select a.application_id, a.created_at
    into v_application_id, v_created_at
    from public.apply_to_job(
      p_job_id,
      p_applicant_id,
      p_name,
      p_portfolio_url,
      p_linkedin_url,
      null
    ) as a
   limit 1;

  if v_application_id is null then
    raise exception using errcode = 'P0001', message = 'application_not_created';
  end if;

  update public.job_applications
     set resume_key = p_resume_key
   where id = v_application_id
     and applicant_id = p_applicant_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0001', message = 'resume_key_not_attached';
  end if;

  return query select v_application_id, v_created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bump_usage_counter(p_user_id uuid, p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit  integer;
  v_period text;
  v_key    text;
  v_count  integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  select cl.limit_count, cl.period
    into v_limit, v_period
    from public.creation_limits as cl
   where cl.kind = p_kind;

  if v_limit is null then
    raise exception using errcode = '22023', message = 'unknown_limit:' || p_kind;
  end if;

  -- Fixed to the server's UTC calendar: no client input reaches this.
  v_key := case v_period
    when 'day'   then to_char((now() at time zone 'utc'), 'YYYY-MM-DD')
    when 'month' then to_char((now() at time zone 'utc'), 'YYYY-MM')
    when 'total' then 'total'
    else null
  end;

  if v_key is null then
    -- 'standing' budgets are counted from live rows (membership trigger);
    -- they must never be bumped.
    raise exception using errcode = '22023', message = 'counter_not_bumpable:' || p_kind;
  end if;

  -- One statement ‚Äî the row lock serializes concurrent bumps, so each
  -- caller sees a count that includes every other caller's bump.
  insert into public.usage_counters as uc (user_id, kind, period_key, count, updated_at)
  values (p_user_id, p_kind, v_key, 1, now())
  on conflict (user_id, kind, period_key) do update
    set count      = uc.count + 1,
        updated_at = now()
  returning uc.count into v_count;

  if v_count > v_limit then
    raise exception using errcode = 'P0001', message = 'limit:' || p_kind;
  end if;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_user_password(p_user_id uuid, p_password_hash text, p_keep_session_id uuid, p_expected_hash text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nullif(p_password_hash, '') is null then
    raise exception 'password_hash_invalid' using errcode = '22023';
  end if;

  update public.users
     set password_hash = p_password_hash,
         updated_at = now()
   where id = p_user_id
     and (p_expected_hash is null or password_hash = p_expected_hash);

  if not found then
    raise exception 'password_changed' using errcode = 'P0001';
  end if;

  return public.revoke_other_user_sessions(
    p_user_id,
    p_keep_session_id,
    'password_change'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.company_confidence_meets_threshold(p_confidence text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select public.company_confidence_rank(p_confidence) >= 2;
$function$;

CREATE OR REPLACE FUNCTION public.company_confidence_rank(p_confidence text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case lower(coalesce(p_confidence, 'unknown'))
    when 'high' then 3
    when 'medium' then 2
    when 'low' then 1
    else 0
  end;
$function$;

CREATE OR REPLACE FUNCTION public.company_directory_seed_retirement_plan()
 RETURNS TABLE(company_id uuid, name text, slug text, domain text, disposable boolean, reason text, claims integer, members integer, verifications integer, profile_pointers integer, verified_claims integer, observations integer, aliases integer, relationships integer, reviews integer, delegations integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with seeded as (
    select retired.slug, retired.name, retired.domain
    from public.company_directory_seed_retired as retired
  ),
  candidate as (
    select
      company.id,
      company.name,
      company.slug,
      company.source,
      company.source_id,
      seeded.domain
    from public.companies as company
    join seeded on seeded.slug = company.slug
    -- A member's company is never a seed row, even when the name matches: the
    -- seed inserted with `on conflict (slug) do nothing`, so a company a member
    -- created first is the row that exists and the seed's insert was skipped.
    where company.created_by is null
  ),
  counted as (
    select
      candidate.*,
      (select count(*)::integer from public.company_domains as cd
        where cd.company_id = candidate.id) as claims,
      (select count(*)::integer from public.company_members as m
        where m.company_id = candidate.id) as members,
      (select count(*)::integer from public.company_email_verifications as v
        where v.company_id = candidate.id
           or v.domain_owner_company_id = candidate.id) as verifications,
      (select count(*)::integer from public.designer_profiles as p
        where p.company_id = candidate.id) as profile_pointers,
      (select count(*)::integer from public.company_domains as cd
        where cd.company_id = candidate.id and cd.verified) as verified_claims,
      (select count(*)::integer from public.domain_evidence as e
        where e.company_id = candidate.id) as observations,
      -- Structure the directory layers attached. NOT a guard: an alias or a
      -- relationship is directory data and goes with the company. It is reported
      -- so the dry run can say what the removal takes with it.
      (select count(*)::integer from public.company_aliases as a
        where a.company_id = candidate.id) as aliases,
      (select count(*)::integer from public.company_relationships as rel
        where rel.parent_company_id = candidate.id
           or rel.child_company_id = candidate.id) as relationships,
      (select count(*)::integer from public.company_domain_reviews as r
        where r.company_id = candidate.id) as reviews,
      (select count(*)::integer from public.company_domain_delegations as g
        where g.company_id = candidate.id or g.granted_by = candidate.id) as delegations,
      -- Claims that are not the seed's own pairing. The seed wrote exactly ONE
      -- claim per company: this company, this domain, unproved, with no
      -- provenance (or the provenance the optional attribution migration gave
      -- it). Anything else on the row came from another layer or an operator — a
      -- second domain, or a source somebody set — and that is a touch like any
      -- other.
      --
      -- A NULL source is the seed's own claim, deliberately: the attribution
      -- migration was applied to some databases and not others, and the
      -- un-attributed shape must still be removable, or the reset would refuse
      -- to run over the entire seed.
      (select count(*)::integer from public.company_domains as cd
        where cd.company_id = candidate.id
          and (cd.domain <> candidate.domain
               or (cd.source is not null and cd.source <> 'wikidata-p856'))) as alien_claims
    from candidate
  )
  select
    counted.id,
    counted.name,
    counted.slug,
    counted.domain,
    -- Every guard at once. The order of the reason is the order a person would
    -- ask about them: a member first, then a proof, then an operator's work.
    (counted.members = 0
      and counted.verifications = 0
      and counted.profile_pointers = 0
      and counted.verified_claims = 0
      and counted.observations = 0
      and counted.reviews = 0
      and counted.delegations = 0
      and counted.alien_claims = 0
      and (counted.source is null or counted.source = 'wikidata-p856')
      and counted.source_id is null) as disposable,
    case
      when counted.members > 0 then 'member_joined'
      when counted.verifications > 0 then 'member_verification'
      when counted.profile_pointers > 0 then 'member_profile_points_at_it'
      when counted.verified_claims > 0 then 'owns_a_verified_domain'
      when counted.observations > 0 then 'carries_observations'
      when counted.reviews > 0 then 'operator_reviewed'
      when counted.delegations > 0 then 'delegation_names_it'
      when counted.alien_claims > 0 then 'claim_the_seed_did_not_write'
      when counted.source is not null and counted.source <> 'wikidata-p856' then 'another_layer_owns_it'
      when counted.source_id is not null then 'has_a_registry_identity'
      else null
    end,
    counted.claims,
    counted.members,
    counted.verifications,
    counted.profile_pointers,
    counted.verified_claims,
    counted.observations,
    counted.aliases,
    counted.relationships,
    counted.reviews,
    counted.delegations
  from counted
  order by counted.slug;
$function$;

CREATE OR REPLACE FUNCTION public.company_domain_claims(p_domain text)
 RETURNS TABLE(company_id uuid, name text, slug text, is_active boolean, verified boolean, domain_type text, evidence_confidence text, source text, evidence_count bigint, claim_created_at timestamp with time zone, superseded boolean, retired boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    c.id,
    c.name,
    c.slug,
    c.is_active,
    d.verified,
    d.domain_type,
    d.evidence_confidence,
    d.source,
    (select count(*) from public.domain_evidence as e
      where e.domain = d.domain and e.company_id = d.company_id
        and e.source is distinct from 'member_domain_control'),
    d.created_at,
    (not d.verified and exists (
      select 1 from public.company_domains as v
      where v.domain = d.domain and v.verified and v.company_id <> d.company_id
    )),
    exists (
      select 1 from public.domain_evidence as e
      where e.domain = d.domain and e.company_id = d.company_id
        and e.evidence_type = 'operator_reassignment_retired'
    )
  from public.company_domains as d
  join public.companies as c on c.id = d.company_id
  where d.domain = lower(btrim(coalesce(p_domain, '')))
  order by d.verified desc,
           public.company_confidence_rank(d.evidence_confidence) desc,
           d.created_at asc,
           c.name asc;
$function$;

CREATE OR REPLACE FUNCTION public.company_domain_delegation_allowed(p_company_id uuid, p_domain text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.company_domain_delegations as dl
    where dl.company_id = p_company_id
      and dl.domain = lower(btrim(coalesce(p_domain, '')))
      and dl.review_status = 'reviewed'
      and exists (
        select 1 from public.company_domains as d
        where d.domain = dl.domain and d.company_id = dl.granted_by
      )
      and exists (
        select 1
        from jsonb_array_elements(dl.evidence) as entry(value)
        where case
                when jsonb_typeof(entry.value -> 'checked') = 'boolean'
                  then (entry.value ->> 'checked')::boolean
                else false
              end
          and coalesce(entry.value ->> 'type', '') not in (
            'mx_record', 'ct_certificate', 'mx', 'mx_only',
            'redirect_from_website', 'website_domain_match'
          )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.company_domain_evidence_supports_promotion(p_company_id uuid, p_domain text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.domain_evidence as e
    where e.company_id = p_company_id
      and e.domain = lower(btrim(coalesce(p_domain, '')))
      and e.checked
      and e.source is distinct from 'member_domain_control'
      -- The evidence kinds a reviewer may act on: something first-party says
      -- this company uses that domain. MX is absent on purpose (it proves mail
      -- infrastructure exists, not who uses it), and the denied kinds cannot be
      -- stored at all (see domain_evidence_type_check).
      and e.evidence_type in (
        'first_party_contact_page',
        'first_party_legal_page',
        'first_party_careers_page',
        'first_party_documentation',
        'published_corporate_email',
        'registry_record',
        'operator_review'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.company_domain_owner(p_domain text)
 RETURNS TABLE(company_id uuid, name text, slug text, verified boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, c.name, c.slug, d.verified
  from public.company_domains as d
  join public.companies as c on c.id = d.company_id
  where d.domain = lower(btrim(p_domain))
  order by d.verified desc, d.created_at asc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.company_domain_review_queue(p_limit integer DEFAULT 50)
 RETURNS TABLE(domain text, company_id uuid, company_name text, company_slug text, evidence_confidence text, observations integer, first_observed_at timestamp with time zone, last_observed_at timestamp with time zone, last_decision text, last_decision_at timestamp with time zone, review_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with v_max as (
    select least(greatest(coalesce(p_limit, 50), 1), 200) as n
  ),
  observed as (
    select
      e.company_id,
      e.domain,
      count(*)::integer as observations,
      min(coalesce(e.observed_at, e.created_at)) as first_observed_at,
      max(coalesce(e.observed_at, e.created_at)) as last_observed_at
    from public.domain_evidence as e
    where e.source = 'member_domain_control'
    group by e.company_id, e.domain
  ),
  last_review as (
    select r.company_id, r.domain, r.decision, r.created_at, r.reason
    from (
      select
        r.*,
        row_number() over (
          partition by r.company_id, r.domain order by r.created_at desc, r.id desc
        ) as rn
      from public.company_domain_reviews as r
    ) as r
    where r.rn = 1
  )
  select
    o.domain,
    o.company_id,
    c.name,
    c.slug,
    d.evidence_confidence,
    o.observations,
    o.first_observed_at,
    o.last_observed_at,
    lr.decision,
    lr.created_at,
    (select count(*)::integer from public.company_domain_reviews as r
      where r.company_id = o.company_id and r.domain = o.domain)
  from observed as o
  join public.companies as c on c.id = o.company_id and c.is_active
  join public.company_domains as d on d.company_id = o.company_id and d.domain = o.domain
  left join last_review as lr on lr.company_id = o.company_id and lr.domain = o.domain
  where not d.verified
    -- Nor one somebody else has already proved for a different company: that is
    -- the reassignment path (`reassign_company_domain`), not a promotion, and
    -- offering it here would only produce a claim that can never be verified.
    and not exists (
      select 1 from public.company_domains as v
      where v.domain = o.domain and v.verified and v.company_id <> o.company_id
    )
    and (
      lr.decision is null
      or lr.decision = 'needs_more_evidence'
      -- Rejected, but something new has been observed since: the decision was an
      -- answer to the evidence that existed then, not a permanent verdict.
      or (
        lr.decision = 'reject'
        and exists (
          select 1 from public.domain_evidence as e2
          where e2.company_id = o.company_id
            and e2.domain = o.domain
            and coalesce(e2.observed_at, e2.created_at) > lr.created_at
        )
      )
    )
  order by o.last_observed_at desc, c.name asc, o.domain asc
  limit (select n from v_max);
$function$;

CREATE OR REPLACE FUNCTION public.company_domain_steward(p_domain text)
 RETURNS TABLE(company_id uuid, name text, slug text, verified boolean, evidence_confidence text, domain_type text, claim_count integer, contested boolean, retired boolean, resolution text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with claims as (
    select
      d.id, d.company_id, d.verified, d.evidence_confidence, d.domain_type, d.created_at,
      -- Observations that only establish DOMAIN CONTROL are recorded (see the
      -- verification functions) but deliberately do not weigh a claim: they say
      -- somebody has a mailbox there, never that the claim is right, and the
      -- resolver must not hand a guess more authority because of one.
      (select count(*) from public.domain_evidence as e
        where e.domain = d.domain and e.company_id = d.company_id
          and e.source is distinct from 'member_domain_control') as evidence_count,
      -- Retired by an operator (a reassignment says this company does not have
      -- the domain any more). The row is kept — it is history — but it stops
      -- competing for the steward, otherwise the company that just gave the
      -- domain up would tie with the one that received it.
      exists (
        select 1 from public.domain_evidence as e
        where e.domain = d.domain and e.company_id = d.company_id
          and e.evidence_type = 'operator_reassignment_retired'
      ) as retired
    from public.company_domains as d
    where d.domain = lower(btrim(coalesce(p_domain, '')))
      and exists (
        select 1 from public.companies as c where c.id = d.company_id and c.is_active
      )
  ), ranked as (
    select
      cl.*,
      count(*) over () as claim_count,
      row_number() over (
        order by cl.verified desc,
                 cl.retired asc,
                 public.company_confidence_rank(cl.evidence_confidence) desc,
                 cl.evidence_count desc,
                 cl.created_at asc,
                 cl.company_id asc
      ) as rn
    from claims as cl
  ), best as (
    select * from ranked where rn = 1
  )
  select
    c.id,
    c.name,
    c.slug,
    b.verified,
    b.evidence_confidence,
    b.domain_type,
    b.claim_count::integer,
    -- Contested = more than one claim ties at the best tier. A verified claim
    -- plus any number of hints is NOT contested: the proof already decided. A
    -- retired claim never ties for the steward; it only surfaces when it is the
    -- only thing left, and then `retired` says so.
    coalesce((
      select count(*) from ranked as r2
      where r2.rn > 1
        and r2.verified = b.verified
        and r2.retired = b.retired
        and public.company_confidence_rank(r2.evidence_confidence)
            = public.company_confidence_rank(b.evidence_confidence)
    ), 0) > 0,
    b.retired,
    case
      when b.verified then 'verified'
      when b.claim_count > 1 and exists (
        select 1 from ranked as r3
        where r3.rn > 1
          and r3.retired = b.retired
          and public.company_confidence_rank(r3.evidence_confidence)
              = public.company_confidence_rank(b.evidence_confidence)
      ) then 'contested'
      else 'claim'
    end
  from best as b
  join public.companies as c on c.id = b.company_id
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.company_featured_renumber()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_moved integer;
begin
  with ordered as (
    select
      c.id,
      row_number() over (order by c.featured_rank asc, c.name asc, c.id asc) as position
    from public.companies as c
    where c.featured_rank is not null
  )
  update public.companies as c
     set featured_rank = o.position
    from ordered as o
   where c.id = o.id
     and c.featured_rank is distinct from o.position;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$function$;

CREATE OR REPLACE FUNCTION public.company_search_term(p_query text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
$function$;

CREATE OR REPLACE FUNCTION public.company_slugify(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    nullif(
      left(trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g')), 60),
      ''
    ),
    'company'
  );
$function$;

CREATE OR REPLACE FUNCTION public.complete_password_reset(p_token text, p_password_hash text)
 RETURNS TABLE(status text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reset_id uuid;
  v_user_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
begin
  if nullif(p_password_hash, '') is null then
    raise exception 'password_hash_invalid' using errcode = '22023';
  end if;

  select pr.id, pr.user_id, pr.expires_at, pr.used_at
    into v_reset_id, v_user_id, v_expires_at, v_used_at
    from public.password_resets pr
   where pr.token = p_token
     for update;

  if v_reset_id is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_used_at is not null then
    return query select 'used'::text, v_user_id;
    return;
  end if;

  if v_expires_at <= now() then
    return query select 'expired'::text, v_user_id;
    return;
  end if;

  update public.password_resets
     set used_at = now()
   where id = v_reset_id;

  update public.users
     set password_hash = p_password_hash,
         session_version = session_version + 1,
         updated_at = now()
   where id = v_user_id;

  if not found then
    return query select 'missing_user'::text, v_user_id;
    return;
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, 'password_reset')
   where auth_sessions.user_id = v_user_id
     and revoked_at is null;

  return query select 'ok'::text, v_user_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_signup(p_name text, p_email text, p_password_hash text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text, p_avatar_url text, p_avatar_source text, p_invitation_token text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, application_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_application_id uuid;
  v_user_id uuid;
begin
  if nullif(btrim(p_name), '') is null
     or nullif(btrim(p_email), '') is null
     or nullif(p_password_hash, '') is null
     or nullif(p_experience_level, '') is null
     or nullif(p_job_title, '') is null
     or (p_avatar_url is null) <> (p_avatar_source is null)
     or (p_avatar_source is not null and p_avatar_source <> 'upload') then
    raise exception using errcode = '22023', message = 'invalid_signup_payload';
  end if;

  if p_invitation_token is not null then
    select i.application_id
      into v_application_id
      from public.invitations as i
     where i.token = p_invitation_token
       and i.used_at is null
       and i.expires_at >= now()
     for update;

    if v_application_id is null then
      raise exception using errcode = 'P0001', message = 'invitation_unavailable';
    end if;

    if exists (
      select 1 from public.users as u
       where u.application_id = v_application_id
    ) then
      raise exception using errcode = '23505', message = 'application_already_registered';
    end if;
  end if;

  if exists (select 1 from public.users as u where lower(u.email) = lower(p_email)) then
    raise exception using errcode = '23505', message = 'email_already_registered';
  end if;

  if not exists (select 1 from public.cities as c where c.id = p_city_id and c.is_active)
     or not exists (select 1 from public.design_sectors as s where s.id = p_sector_id and s.is_active)
     or not exists (select 1 from public.experience_levels as e where e.slug = p_experience_level and e.is_active)
     or not exists (select 1 from public.job_titles as j where j.slug = p_job_title and j.is_active) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  insert into public.users (application_id, name, email, password_hash)
  values (v_application_id, btrim(p_name), lower(btrim(p_email)), p_password_hash)
  returning id into v_user_id;

  insert into public.designer_profiles (
    user_id,
    city_id,
    sector_id,
    experience_level,
    job_title,
    avatar_url,
    avatar_source
  ) values (
    v_user_id,
    p_city_id,
    p_sector_id,
    p_experience_level,
    p_job_title,
    p_avatar_url,
    p_avatar_source
  );

  if v_application_id is not null then
    update public.invitations
       set used_at = now()
     where token = p_invitation_token
       and application_id = v_application_id
       and used_at is null;

    if not found then
      raise exception using errcode = 'P0001', message = 'invitation_unavailable';
    end if;
  end if;

  return query select v_user_id, v_application_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_signup_with_consent(p_name text, p_email text, p_password_hash text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text, p_avatar_url text, p_avatar_source text, p_age_confirmed boolean, p_terms_accepted boolean, p_terms_version text, p_invitation_token text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, application_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
  v_application_id uuid;
  v_updated integer;
begin
  if p_age_confirmed is not true or p_terms_accepted is not true then
    raise exception using errcode = 'P0001', message = 'consent_required';
  end if;

  if nullif(btrim(p_terms_version), '') is null then
    raise exception using errcode = '22023', message = 'consent_version_required';
  end if;

  -- The inner function is SECURITY DEFINER and owns the account/profile
  -- inserts. Calling it from this function keeps those inserts and the consent
  -- write in one transaction: any failure rolls the whole signup back.
  select c.user_id, c.application_id
    into v_user_id, v_application_id
    from public.complete_signup(
      p_name,
      p_email,
      p_password_hash,
      p_city_id,
      p_sector_id,
      p_experience_level,
      p_job_title,
      p_avatar_url,
      p_avatar_source,
      p_invitation_token
    ) as c
   limit 1;

  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'signup_not_created';
  end if;

  update public.users
     set age_confirmed_at = now(),
         terms_accepted_at = now(),
         terms_version = btrim(p_terms_version),
         updated_at = now()
   where id = v_user_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0001', message = 'consent_not_recorded';
  end if;

  return query select v_user_id, v_application_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_company_verification(p_user_id uuid, p_verification_id uuid, p_code_hash text)
 RETURNS TABLE(status text, attempts_left integer, company_id uuid, company_name text, company_slug text, company_logo_url text, domain text, joined_at timestamp with time zone, domain_owner_company_id uuid, verified_via text, claim_confidence text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row           public.company_email_verifications;
  v_company_id    uuid;
  v_company_name  text;
  v_company_slug  text;
  v_logo_url      text;
  v_slug_base     text;
  v_slug          text;
  v_suffix        integer := 1;
  v_domain_row_id uuid;
  v_joined_at     timestamptz;
  v_owner_id      uuid;
  v_strong_id     uuid;
  v_via           text;
  v_claim_confidence text;
  v_attempts      integer;
begin
  select * into v_row
  from public.company_email_verifications as v
  where v.id = p_verification_id and v.user_id = p_user_id
  for update;

  if v_row.id is null then
    return query select 'not_found'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  if v_row.consumed_at is not null then
    return query select 'already_used'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select 'expired'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  v_attempts := v_row.attempts;

  if v_attempts >= 5 then
    return query select 'too_many_attempts'::text, 0, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  if v_row.code_hash is distinct from p_code_hash then
    update public.company_email_verifications as v
    set attempts = v.attempts + 1
    where v.id = v_row.id
    returning v.attempts into v_attempts;

    -- The last wrong guess burns the challenge: the route sends the member back
    -- to the start, which also invalidates the emailed code.
    if v_attempts >= 5 then
      update public.company_email_verifications as v
      set consumed_at = now()
      where v.id = v_row.id;
    end if;

    return query select 'invalid_code'::text, greatest(5 - v_attempts, 0), null::uuid,
      null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  -- Is the domain already someone's verified domain?
  select d.company_id into v_owner_id
  from public.company_domains as d
  where d.domain = v_row.domain and d.verified
  limit 1;

  if v_row.company_id is not null then
    -- ── Joining an existing company ──────────────────────────
    select c.id, c.name, c.slug, c.logo_url
      into v_company_id, v_company_name, v_company_slug, v_logo_url
    from public.companies as c
    where c.id = v_row.company_id and c.is_active;

    if v_company_id is null then
      return query select 'company_inactive'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;

    if v_owner_id is distinct from v_company_id then
      -- Nobody has proved this domain for this company. Two ways in remain.
      if v_owner_id is not null then
        -- Proved by somebody else between start and confirm: only a reviewed
        -- delegation saves the challenge, because the domain is theirs.
        if public.company_domain_delegation_allowed(v_company_id, v_row.domain) then
          v_via := 'delegation';
        else
          return query select 'domain_already_verified'::text, null::integer, null::uuid,
            null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
          return;
        end if;
      elsif exists (
        select 1 from public.company_domains as d
        where d.company_id = v_company_id and d.domain = v_row.domain and not d.verified
      ) then
        -- The company's own claim. Whether the code may PROMOTE it depends on
        -- the evidence behind it:
        --
        --   high/medium  a reviewed source says this is the company's mail
        --                domain; the member's mailbox settles it -> verified.
        --   low/unknown  a guess (every one of the 4,574 seeded hints). The
        --                code proves DOMAIN CONTROL, which is a true
        --                observation about the mailbox and says nothing about
        --                whether the directory mapped the domain to the right
        --                company. It is recorded as evidence and nothing else:
        --                no verified claim, no membership. Otherwise anyone
        --                holding a mailbox at a domain the directory guessed
        --                could hand that guess the authority of a proof.
        select d.evidence_confidence into v_claim_confidence
        from public.company_domains as d
        where d.company_id = v_company_id and d.domain = v_row.domain and not d.verified
        order by public.company_confidence_rank(d.evidence_confidence) desc
        limit 1;

        if public.company_confidence_meets_threshold(v_claim_confidence) then
          -- Above the threshold: the proof is what promotes the claim, and the
          -- promotion is where the race is decided — the partial unique index is
          -- the boundary, so a concurrent proof by another company raises
          -- unique_violation, caught here (it must not roll back the challenge)
          -- and answered with `domain_already_verified` so the member joins that
          -- company instead.
          begin
            update public.company_domains as d
            set verified = true, verified_at = now()
            where d.company_id = v_company_id
              and d.domain = v_row.domain
              and not d.verified;
          exception when unique_violation then
            return query select 'domain_already_verified'::text, null::integer, null::uuid,
              null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
            return;
          end;

          if not found then
            select d.company_id into v_owner_id
            from public.company_domains as d
            where d.domain = v_row.domain and d.verified
            limit 1;

            if v_owner_id is distinct from v_company_id then
              return query select 'domain_already_verified'::text, null::integer, null::uuid,
                null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
              return;
            end if;
          else
            insert into public.domain_evidence (
              company_id, domain, evidence_type, source_url, source, checked, observed_at
            ) values (
              v_company_id, v_row.domain, 'work_email_otp', null, 'member_verification', true, now()
            )
            on conflict do nothing;
          end if;

          v_via := 'own_domain';
        else
          -- ── Below the threshold: the mailbox is still the member's ──────
          -- The claim is weak (a `low` or `unknown` hint — every curated
          -- directory row), so the code may not turn it into the domain's
          -- authority. It still proves the MAILBOX, and the member still works
          -- where that mailbox is: they chose this company from the picker and
          -- answered a code sent to its domain, which is the whole of what
          -- "where do you work?" asked them for.
          --
          -- So the observation is recorded exactly as the truth it is
          -- (`member_domain_control`: true about the mailbox, silent about the
          -- mapping) and the flow continues to the membership and the profile
          -- pointer below. What is NOT granted is the domain:
          -- `company_domains.verified` stays false, so a guess never becomes an
          -- authority over a domain, and an operator still sees this claim in
          -- `company_domain_review_queue()` to promote or reject on its own
          -- merits.
          insert into public.domain_evidence (
            company_id, domain, evidence_type, source_url, source, checked, observed_at
          ) values (
            v_company_id, v_row.domain, 'work_email_otp', null, 'member_domain_control', true, now()
          )
          on conflict do nothing;

          -- `verified_via`: in through the mailbox, not through a proved domain.
          v_via := 'mailbox_only';
        end if;
      elsif public.company_domain_delegation_allowed(v_company_id, v_row.domain) then
        -- No claim of its own, no proof anywhere, but a reviewed delegation
        -- says this company's staff do use the domain. The membership is this
        -- company's; the domain is not claimed on its behalf.
        select s.company_id into v_owner_id
        from public.company_domain_steward(v_row.domain) as s;

        v_via := 'delegation';
      else
        return query select 'domain_not_verified'::text, null::integer, null::uuid,
          null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
        return;
      end if;
    else
      v_via := 'own_domain';
    end if;
  else
    -- ── Creating a company from the name typed at start ──────
    if v_owner_id is not null then
      return query select 'domain_already_verified'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;

    -- A MEDIUM+ claim that appeared between the challenge and this confirmation
    -- (a reviewed layer, or an operator preparing the entry) must not be spent
    -- on a second company for the same domain. A weak hint does not block: the
    -- proof below supersedes it, and the hint survives as evidence.
    select d.company_id into v_strong_id
    from public.company_domains as d
    join public.companies as c on c.id = d.company_id and c.is_active
    where d.domain = v_row.domain
      and not d.verified
      and d.evidence_confidence in ('high', 'medium')
    limit 1;

    if v_strong_id is not null then
      return query select 'domain_already_verified'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;

    v_slug_base := left(public.company_slugify(v_row.company_name), 48);
    v_slug := v_slug_base;
    while exists (select 1 from public.companies as c where c.slug = v_slug) loop
      v_suffix := v_suffix + 1;
      v_slug := v_slug_base || '-' || v_suffix;
    end loop;

    insert into public.companies (name, slug, created_by)
    values (v_row.company_name, v_slug, p_user_id)
    returning id, name, slug, logo_url
      into v_company_id, v_company_name, v_company_slug, v_logo_url;

    insert into public.company_domains (
      company_id, domain, verified, verified_at, domain_type, evidence_confidence, source
    )
    values (v_company_id, v_row.domain, true, now(), 'corporate_email', 'high', 'member_verification')
    on conflict do nothing
    returning id into v_domain_row_id;

    if v_domain_row_id is null then
      -- Another member verified this domain in the meantime. Raising rolls
      -- back the company row inserted above, so no orphan duplicate is left.
      raise exception using errcode = 'P0001', message = 'domain_already_verified';
    end if;

    insert into public.domain_evidence (
      company_id, domain, evidence_type, source_url, source, checked, observed_at
    ) values (
      v_company_id, v_row.domain, 'work_email_otp', null, 'member_verification', true, now()
    )
    on conflict do nothing;

    v_via := 'own_domain';
  end if;

  -- Membership. An earlier unverified row for this pair is promoted, so a
  -- member who was recorded but never proven becomes verified here.
  -- Named constraint, not `on conflict (company_id, user_id)`: this function's
  -- OUT parameters include `company_id`, and PL/pgSQL resolves a conflict
  -- target column list against its variables, which makes the bare form
  -- ambiguous. For the same reason the timestamp is read back in its own
  -- statement rather than through `returning joined_at`.
  insert into public.company_members (company_id, user_id, verified, joined_at)
  values (v_company_id, p_user_id, true, now())
  on conflict on constraint company_members_company_user_key
    do update set verified = true, joined_at = now();

  select m.joined_at into v_joined_at
  from public.company_members as m
  where m.company_id = v_company_id and m.user_id = p_user_id;

  -- The profile pointer is separate from membership: this is which company the
  -- member displays, and it can be cleared again through leave_company().
  update public.designer_profiles as dp
  set company_id = v_company_id, updated_at = now()
  where dp.user_id = p_user_id;

  update public.company_email_verifications as v
  set consumed_at = now()
  where v.id = v_row.id;

  -- The steward the member's membership is NOT: null for their own company
  -- (the ordinary case), the owner of the domain when they verified through a
  -- delegation. Returned so the UI can say whose domain it was.
  return query select 'verified'::text, null::integer, v_company_id, v_company_name,
    v_company_slug, v_logo_url, v_row.domain, v_joined_at,
    case when v_via = 'delegation' then v_owner_id else null end,
    coalesce(v_via, 'own_domain'),
    v_claim_confidence;
end;
$function$;

CREATE OR REPLACE FUNCTION public.count_join_slots(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.community_members as m
    join public.communities as c on c.id = m.community_id
   where m.user_id = p_user_id
     and c.type <> 'event'
     and c.is_active
     and (c.type <> 'user' or c.owner_id is not null);
$function$;

CREATE OR REPLACE FUNCTION public.count_live_creations(p_user_id uuid, p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from timestamptz;
begin
  if p_user_id is null then
    return 0;
  end if;

  v_from := public.creation_window_start(
    case p_kind
      when 'posts_daily'    then 'day'
      when 'events_monthly' then 'month'
      when 'jobs_monthly'   then 'month'
      else 'total'
    end
  );

  return case p_kind
    -- "A post" is still defined in exactly one place: threads, showcase
    -- posts and resources share this budget.
    when 'posts_daily' then (
      select count(*)::integer from (
        select created_at from public.community_threads        where user_id = p_user_id
        union all
        select created_at from public.community_showcase_posts where user_id = p_user_id
        union all
        select created_at from public.community_resources      where user_id = p_user_id
      ) as posts
      where posts.created_at >= v_from
    )
    when 'events_monthly' then (
      select count(*)::integer
        from public.community_events
       where user_id = p_user_id
         and created_at >= v_from
    )
    when 'jobs_monthly' then (
      select count(*)::integer
        from public.job_posts
       where poster_id = p_user_id
         and created_at >= v_from
    )
    else 0
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_auth_session(p_user_id uuid, p_role text, p_expires_at timestamp with time zone, p_user_agent text DEFAULT NULL::text)
 RETURNS TABLE(session_id uuid, session_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_version integer;
begin
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'session_expiry_invalid' using errcode = '22023';
  end if;

  if p_role = 'user' then
    if p_user_id is null then
      raise exception 'session_subject_invalid' using errcode = '22023';
    end if;

    select u.session_version
      into v_version
      from public.users u
     where u.id = p_user_id
       and u.is_blocked = false;

    if v_version is null then
      raise exception 'account_unavailable' using errcode = 'P0001';
    end if;
  elsif p_role = 'admin' then
    if p_user_id is not null then
      raise exception 'session_subject_invalid' using errcode = '22023';
    end if;
    v_version := 0;
  else
    raise exception 'session_role_invalid' using errcode = '22023';
  end if;

  return query
    insert into public.auth_sessions (
      user_id,
      role,
      session_version,
      expires_at,
      user_agent
    )
    values (
      p_user_id,
      p_role,
      v_version,
      p_expires_at,
      nullif(left(coalesce(p_user_agent, ''), 512), '')
    )
    returning auth_sessions.id, auth_sessions.session_version;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_job_post(p_poster_id uuid, p_kind text, p_company_id uuid, p_title text, p_city_id uuid, p_sector_id uuid, p_job_title text, p_experience_level text, p_work_mode text, p_employment_type text, p_salary text, p_description text, p_responsibilities text[] DEFAULT '{}'::text[], p_requirements text[] DEFAULT '{}'::text[], p_skills text[] DEFAULT '{}'::text[], p_website text DEFAULT NULL::text, p_closes_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(job_id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind        text := btrim(coalesce(p_kind, ''));
  v_title       text := btrim(coalesce(p_title, ''));
  v_job_title   text := btrim(coalesce(p_job_title, ''));
  v_experience  text := btrim(coalesce(p_experience_level, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_salary      text := nullif(btrim(coalesce(p_salary, '')), '');
  v_website     text := nullif(btrim(coalesce(p_website, '')), '');
  v_responsibilities text[];
  v_requirements     text[];
  v_skills           text[];
begin
  if p_poster_id is null
     or not exists (select 1 from public.users as u where u.id = p_poster_id) then
    raise exception using errcode = '23503', message = 'unknown_user';
  end if;

  if v_kind not in ('hiring', 'referral') then
    raise exception using errcode = '22023', message = 'invalid_kind';
  end if;

  if char_length(v_title) < 2 or char_length(v_title) > 140 then
    raise exception using errcode = '22023', message = 'invalid_title';
  end if;

  if v_description = '' then
    raise exception using errcode = '22023', message = 'missing_description';
  end if;

  if p_work_mode not in ('remote', 'hybrid', 'onsite') then
    raise exception using errcode = '22023', message = 'invalid_work_mode';
  end if;

  if p_employment_type not in ('full_time', 'part_time', 'contract', 'internship') then
    raise exception using errcode = '22023', message = 'invalid_employment_type';
  end if;

  if not exists (
    select 1 from public.companies as c
    where c.id = p_company_id and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'company_inactive';
  end if;

  -- The company is only real for the poster once they have proved a
  -- work email on one of its domains. This is the same row the
  -- profile badge reads; a job can never be posted for a company
  -- the poster has not verified.
  if not exists (
    select 1 from public.company_members as m
    where m.company_id = p_company_id
      and m.user_id = p_poster_id
      and m.verified
  ) then
    raise exception using errcode = 'P0001', message = 'company_not_verified';
  end if;

  -- NULL is the All wildcard and skips the check; a named city must
  -- still be live master data.
  if p_city_id is not null and not exists (
    select 1 from public.cities as ci
    where ci.id = p_city_id and ci.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_city';
  end if;

  if p_sector_id is not null and not exists (
    select 1 from public.design_sectors as se
    where se.id = p_sector_id and se.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_sector';
  end if;

  if not exists (
    select 1 from public.job_titles as jt
    where jt.slug = v_job_title and jt.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_job_title';
  end if;

  if not exists (
    select 1 from public.experience_levels as el
    where el.slug = v_experience and el.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_experience_level';
  end if;

  if v_website is not null and v_website !~* '^https?://' then
    raise exception using errcode = '22023', message = 'invalid_website';
  end if;

  -- List fields are stored trimmed, blank rows dropped, capped at 20
  -- items of 200 characters — the same normalisation the detail page
  -- renders back.
  v_responsibilities := (
    select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
    from unnest(coalesce(p_responsibilities, '{}'::text[])) with ordinality as t (item, ord)
    where btrim(item) <> ''
  );
  v_requirements := (
    select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
    from unnest(coalesce(p_requirements, '{}'::text[])) with ordinality as t (item, ord)
    where btrim(item) <> ''
  );
  v_skills := (
    select coalesce((array_agg(left(btrim(item), 60) order by ord))[1:20], '{}')
    from unnest(coalesce(p_skills, '{}'::text[])) with ordinality as t (item, ord)
    where btrim(item) <> ''
  );

  return query
  insert into public.job_posts as jp (
    poster_id, company_id, kind, title,
    city_id, sector_id, job_title, experience_level,
    work_mode, employment_type, salary, description,
    responsibilities, requirements, skills, website, closes_at
  )
  values (
    p_poster_id, p_company_id, v_kind, v_title,
    p_city_id, p_sector_id, v_job_title, v_experience,
    p_work_mode, p_employment_type, left(v_salary, 80), v_description,
    v_responsibilities, v_requirements, v_skills, v_website, p_closes_at
  )
  returning jp.id, jp.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_actor_id uuid, p_community_id uuid, p_type text, p_entity_type text, p_entity_id uuid, p_title text, p_body text, p_href text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(id uuid, user_id uuid, actor_id uuid, community_id uuid, type text, entity_type text, entity_id uuid, title text, body text, href text, metadata jsonb, read_at timestamp with time zone, created_at timestamp with time zone, inserted boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
-- The ON CONFLICT target names columns that are also OUT parameters of this
-- RETURNS TABLE; resolve those identifiers to the table columns, not the
-- variables (the variables are used explicitly as v_row / p_* elsewhere).
#variable_conflict use_column
declare
  v_row public.notifications;
  v_inserted boolean := false;
  v_attempt integer;
begin
  -- The INSERT is the authority. If a concurrent caller already inserted the
  -- unread row, this one conflicts and does nothing; the UPDATE then aggregates
  -- into whatever row won (READ COMMITTED re-reads it after the insert wait).
  for v_attempt in 1..3 loop
    insert into public.notifications
      (user_id, actor_id, community_id, type, entity_type, entity_id,
       title, body, href, metadata)
    values
      (p_user_id, p_actor_id, p_community_id, p_type, p_entity_type, p_entity_id,
       p_title, p_body, p_href, coalesce(p_metadata, '{}'::jsonb))
    on conflict (user_id, entity_type, entity_id) where read_at is null
    do nothing
    returning * into v_row;

    if v_row.id is not null then
      v_inserted := true;
      exit;
    end if;

    -- The unread row already existed, so this event aggregates into it: the
    -- latest event's payload wins and metadata.count records how many events
    -- the single row stands for (same fields, same order, same timestamp bump
    -- as the old application UPDATE).
    update public.notifications as n
    set actor_id     = p_actor_id,
        community_id = p_community_id,
        type         = p_type,
        title        = p_title,
        body         = p_body,
        href         = p_href,
        metadata     = n.metadata
                       || jsonb_build_object(
                            'count',
                            coalesce(nullif(n.metadata ->> 'count', '')::int, 1) + 1
                          ),
        created_at   = now()
    where n.user_id = p_user_id
      and n.entity_type = p_entity_type
      and n.entity_id = p_entity_id
      and n.read_at is null
    returning * into v_row;

    if v_row.id is not null then
      exit;
    end if;
  end loop;

  -- The unread row can be read (or deleted) between the two statements above.
  -- When that happens there is nothing left to aggregate into, so this becomes
  -- a fresh notification; the unique index still guarantees at most one.
  if v_row.id is null then
    insert into public.notifications
      (user_id, actor_id, community_id, type, entity_type, entity_id,
       title, body, href, metadata)
    values
      (p_user_id, p_actor_id, p_community_id, p_type, p_entity_type, p_entity_id,
       p_title, p_body, p_href, coalesce(p_metadata, '{}'::jsonb))
    on conflict (user_id, entity_type, entity_id) where read_at is null
    do nothing
    returning * into v_row;

    if v_row.id is not null then
      v_inserted := true;
    end if;
  end if;

  return query
  select
    v_row.id, v_row.user_id, v_row.actor_id, v_row.community_id, v_row.type,
    v_row.entity_type, v_row.entity_id, v_row.title::text, v_row.body, v_row.href,
    v_row.metadata, v_row.read_at, v_row.created_at, v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.creation_limits_bypassed()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(current_setting('app.bypass_creation_limits', true), '') = 'on';
$function$;

CREATE OR REPLACE FUNCTION public.creation_window_start(p_period text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$
  select case p_period
    when 'day'   then date_trunc('day',   now() at time zone 'utc') at time zone 'utc'
    when 'month' then date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    else '-infinity'::timestamptz
  end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_job_post(p_actor_id uuid, p_job_id uuid)
 RETURNS TABLE(job_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- The applications cascade (job_applications.job_id on delete
  -- cascade); the resume objects stay in R2 for the orphan audit.
  return query
  with removed as (
    delete from public.job_posts as jp
     where jp.id = p_job_id and jp.poster_id = p_actor_id
    returning jp.id
  )
  select removed.id from removed;

  if not found then
    if exists (select 1 from public.job_posts as jp where jp.id = p_job_id) then
      raise exception using errcode = 'P0001', message = 'not_your_job';
    end if;
    raise exception using errcode = 'P0002', message = 'job_not_found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dm_message_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  conv public.dm_conversations%rowtype;
begin
  select * into conv
    from public.dm_conversations c
   where c.id = new.conversation_id
   for update;

  if not found then
    raise exception 'Conversation does not exist' using errcode = '23503';
  end if;

  if new.user_id <> conv.user_a and new.user_id <> conv.user_b then
    raise exception 'Message author must be a participant of the conversation'
      using errcode = '23514';
  end if;

  if new.reply_to_id is not null and not exists (
    select 1
      from public.dm_messages m
     where m.id = new.reply_to_id
       and m.conversation_id = new.conversation_id
  ) then
    raise exception 'Reply must reference a message in the same conversation'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if exists (
      select 1
        from public.dm_blocks b
       where (b.blocker_id = conv.user_a and b.blocked_id = conv.user_b)
          or (b.blocker_id = conv.user_b and b.blocked_id = conv.user_a)
    ) then
      raise exception 'Blocked conversations cannot receive messages'
        using errcode = '23514';
    end if;

    if conv.request_state = 'rejected' then
      raise exception 'Message request was declined' using errcode = '23514';
    end if;

    if conv.request_state = 'pending' then
      if conv.requested_by is null then
        -- The first message makes its author the requester.
        update public.dm_conversations
           set requested_by = new.user_id
         where id = conv.id;
      elsif conv.requested_by = new.user_id then
        if exists (
          select 1
            from public.dm_messages m
           where m.conversation_id = conv.id
             and m.user_id = new.user_id
        ) then
          raise exception 'One message until the request is accepted'
            using errcode = '23514';
        end if;
      else
        -- A reply from the other participant IS the acceptance.
        update public.dm_conversations
           set request_state = 'accepted'
         where id = conv.id;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dm_messages_touch_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.dm_conversations
     set last_message_at = greatest(
           coalesce(last_message_at, new.created_at),
           new.created_at
         )
   where id = new.conversation_id;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dm_reaction_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  msg_conversation_id uuid;
  conv_user_a uuid;
  conv_user_b uuid;
begin
  select m.conversation_id into msg_conversation_id
    from public.dm_messages m
   where m.id = new.message_id;

  if msg_conversation_id is null then
    raise exception 'Message does not exist' using errcode = '23503';
  end if;

  if new.conversation_id <> msg_conversation_id then
    raise exception 'Reaction conversation must match the message conversation'
      using errcode = '23514';
  end if;

  select c.user_a, c.user_b into conv_user_a, conv_user_b
    from public.dm_conversations c
   where c.id = msg_conversation_id;

  if new.user_id <> conv_user_a and new.user_id <> conv_user_b then
    raise exception 'Reactor must be a participant of the conversation'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_community_creation_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cap      integer;
  v_join_cap integer;
  v_count    integer;
begin
  -- Only member-created communities count. Official groups (city, sector,
  -- experience level, job title) are system-created on demand, and event
  -- group chats are created by the event flow (see ensureEventChatCommunity)
  -- — counting those would spend a member's own-community budget on
  -- infrastructure.
  if new.type <> 'user' or new.owner_id is null or public.creation_limits_bypassed() then
    return new;
  end if;

  -- Serialize per owner: two parallel creates must not both read zero.
  perform pg_advisory_xact_lock(
    hashtextextended('community_create_cap:' || new.owner_id::text, 0)
  );

  -- Rule 1 — up to five LIVE communities of your own, counted the way the
  -- sidebar counts: active, with the owner still inside it. Deleting the
  -- community (the soft delete behind the app's Delete button) drops it out
  -- of this count and hands the budget back.
  select cl.limit_count into v_cap
    from public.creation_limits as cl
   where cl.kind = 'communities_total';

  select count(*) into v_count
    from public.communities as c
   where c.owner_id = new.owner_id
     and c.type = 'user'
     and c.is_active
     and exists (
       select 1
         from public.community_members as m
        where m.community_id = c.id
          and m.user_id = c.owner_id
     );

  if v_count >= coalesce(v_cap, 5) then
    raise exception using errcode = 'P0001', message = 'limit:communities_total';
  end if;

  -- Rule 2 — the creator joins their own community, so a creation needs a
  -- free join slot exactly like any other join: a member already in ten live
  -- communities cannot create on top of that.
  select cl.limit_count into v_join_cap
    from public.creation_limits as cl
   where cl.kind = 'community_joins';

  if public.count_join_slots(new.owner_id) >= coalesce(v_join_cap, 10) then
    raise exception using errcode = 'P0001', message = 'limit:community_joins';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_event_creation_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  if public.is_content_restore('event', new.id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('creation_cap:events_monthly:' || new.user_id::text, 0)
  );

  select cl.limit_count into v_limit
    from public.creation_limits as cl
   where cl.kind = 'events_monthly';

  if public.count_live_creations(new.user_id, 'events_monthly') >= coalesce(v_limit, 5) then
    raise exception using errcode = 'P0001', message = 'limit:events_monthly';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_job_creation_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('creation_cap:jobs_monthly:' || new.poster_id::text, 0)
  );

  select cl.limit_count into v_limit
    from public.creation_limits as cl
   where cl.kind = 'jobs_monthly';

  -- A closed or past-closing-date job is still a live row, so it keeps
  -- counting until it is deleted; edits never counted and still do not.
  if public.count_live_creations(new.poster_id, 'jobs_monthly') >= coalesce(v_limit, 3) then
    raise exception using errcode = 'P0001', message = 'limit:jobs_monthly';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_membership_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type  text;
  v_cap   integer;
  v_count integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  select c.type into v_type
    from public.communities as c
   where c.id = new.community_id;

  -- Event group chats are excluded: hosting creates one and RSVPing joins
  -- one, so counting them would let an event break its own host. Unknown
  -- community ids (v_type is null) fall through to the FK error below.
  if v_type is null or v_type = 'event' then
    return new;
  end if;

  -- A duplicate insert — the idempotent re-join/upsert paths — lands on an
  -- existing pair and must not consume a slot or trip the cap.
  if exists (
    select 1
      from public.community_members as m
     where m.community_id = new.community_id
       and m.user_id = new.user_id
  ) then
    return new;
  end if;

  -- Serialize per member so two parallel joins cannot both read nine and
  -- both land; release at commit. Leaving frees a slot — the count is of
  -- live rows.
  perform pg_advisory_xact_lock(
    hashtextextended('community_join_cap:' || new.user_id::text, 0)
  );

  select cl.limit_count into v_cap
    from public.creation_limits as cl
   where cl.kind = 'community_joins';

  v_count := public.count_join_slots(new.user_id);

  if v_count >= coalesce(v_cap, 10) then
    raise exception using errcode = 'P0001', message = 'limit:community_joins';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_post_creation_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  if public.is_content_restore(
       case TG_TABLE_NAME
         when 'community_threads'         then 'thread'
         when 'community_showcase_posts'  then 'showcase'
         when 'community_resources'       then 'resource'
         else null
       end,
       new.id
     ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('creation_cap:posts_daily:' || new.user_id::text, 0)
  );

  select cl.limit_count into v_limit
    from public.creation_limits as cl
   where cl.kind = 'posts_daily';

  if public.count_live_creations(new.user_id, 'posts_daily') >= coalesce(v_limit, 3) then
    raise exception using errcode = 'P0001', message = 'limit:posts_daily';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_community_members_page(p_community_id uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(user_id uuid, joined_at timestamp with time zone, role text, name text, email text, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total  bigint;
begin
  if v_search is null then
    select coalesce(c.member_count, 0)::bigint
    into v_total
    from public.communities as c
    where c.id = p_community_id;
    v_total := coalesce(v_total, 0);
  else
    select count(*)::bigint
    into v_total
    from public.community_members as m
    join public.users as u on u.id = m.user_id
    where m.community_id = p_community_id
      and u.name ilike '%' || v_search || '%';
  end if;

  return query
  select
    m.user_id,
    m.joined_at,
    m.role,
    u.name,
    u.email,
    v_total
  from public.community_members as m
  join public.users as u on u.id = m.user_id
  where m.community_id = p_community_id
    and (v_search is null or u.name ilike '%' || v_search || '%')
  order by
    m.joined_at asc,
    m.user_id asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_all_communities(p_user_id uuid)
 RETURNS TABLE(id uuid, name text, type text, image_url text, lottie_url text, lottie_format text, description text, is_private boolean, member_count bigint, joined boolean, can_join boolean, has_pending_request boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with profile as (
    select
      dp.city_id,
      dp.sector_id,
      el.id as experience_level_id,
      jt.id as job_title_id
    from public.designer_profiles as dp
    left join public.experience_levels as el
      on el.slug = dp.experience_level::text
    left join public.job_titles as jt
      on jt.slug = dp.job_title::text
    where dp.user_id = p_user_id
    limit 1
  )
  select
    c.id,
    c.name,
    c.type,
    coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ) as image_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_url
        when 'sector' then sector.lottie_url
        when 'experience_level' then experience.lottie_url
        when 'job_title' then job.lottie_url
      end,
      c.lottie_url
    ) as lottie_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_format
        when 'sector' then sector.lottie_format
        when 'experience_level' then experience.lottie_format
        when 'job_title' then job.lottie_format
      end,
      c.lottie_format
    ) as lottie_format,
    c.description,
    coalesce(c.is_private, false) as is_private,
    c.member_count::bigint,
    exists (
      select 1
      from public.community_members cm
      where cm.community_id = c.id
        and cm.user_id = p_user_id
    ) as joined,
    case
      when c.type = 'user' then true
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      when c.type = 'job_title' then profile.job_title_id = c.reference_id
      else false
    end as can_join,
    exists (
      select 1
      from public.community_join_requests cjr
      where cjr.community_id = c.id
        and cjr.user_id = p_user_id
        and cjr.status = 'pending'
    ) as has_pending_request
  from public.communities as c
  left join profile on true
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles as job
    on c.type = 'job_title' and job.id = c.reference_id
  where c.is_active = true
    and c.member_count > 0
    and c.type <> 'event'
    and case c.type
      when 'city' then city.id is not null
      when 'sector' then sector.id is not null
      when 'experience_level' then experience.id is not null
      when 'job_title' then job.id is not null
      else true
    end
  order by c.name;
$function$;

CREATE OR REPLACE FUNCTION public.get_community_members_page(p_community_id uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(user_id uuid, joined_at timestamp with time zone, role text, name text, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total  bigint;
begin
  if v_search is null then
    select coalesce(c.member_count, 0)::bigint
    into v_total
    from public.communities as c
    where c.id = p_community_id;
    v_total := coalesce(v_total, 0);
  else
    select count(*)::bigint
    into v_total
    from public.community_members as m
    join public.users as u on u.id = m.user_id
    where m.community_id = p_community_id
      and u.name ilike '%' || v_search || '%';
  end if;

  return query
  select
    m.user_id,
    m.joined_at,
    m.role,
    u.name,
    v_total
  from public.community_members as m
  join public.users as u on u.id = m.user_id
  where m.community_id = p_community_id
    and (v_search is null or u.name ilike '%' || v_search || '%')
  order by
    (case m.role when 'owner' then 0 when 'admin' then 1 else 2 end) asc,
    m.joined_at asc,
    m.user_id asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_community_message_page(p_community_id uuid, p_user_id uuid, p_history_start timestamp with time zone, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_content_ids uuid[] DEFAULT NULL::uuid[], p_before_id uuid DEFAULT NULL::uuid, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, user_id uuid, reply_to_id uuid, reply_to_content_id uuid, image_url text, deleted_at timestamp with time zone, edited_at timestamp with time zone, deleted_by uuid, deleted_by_role text, mentions jsonb, users jsonb, reactions jsonb, reply_to jsonb, reply_to_content jsonb, content_reactions jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with message_page as materialized (
    -- Catch-up: everything strictly newer than the cursor, oldest first, so a
    -- draining client can walk forward page by page from where it stopped.
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.reply_to_content_id, message.image_url,
        message.deleted_at, message.edited_at, message.deleted_by,
        message.deleted_by_role, message.mentions
      from public.community_messages as message
      where p_after is not null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        -- Row-value comparison against the compound cursor: the id tiebreak
        -- makes the order total, so equal-timestamp rows on either side of the
        -- boundary are never lost. A NULL id degrades to the all-zero sentinel,
        -- which can only re-include equal-timestamp rows.
        and (message.created_at, message.id)
              > (p_after, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
      order by message.created_at asc, message.id asc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    union all
    -- Newest page (no cursor) or the page above an older cursor, newest first.
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.reply_to_content_id, message.image_url,
        message.deleted_at, message.edited_at, message.deleted_by,
        message.deleted_by_role, message.mentions
      from public.community_messages as message
      where p_after is null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        and (p_before is null
             or (message.created_at, message.id)
                  < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by message.created_at desc, message.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
  ),
  interesting_content as (
    select distinct unnest(
      coalesce(
        p_content_ids || array_agg(message_page.reply_to_content_id) filter (where message_page.reply_to_content_id is not null),
        p_content_ids
      )
    ) as content_id
    from message_page
  )
  select
    message.id, message.content, message.created_at, message.user_id,
    message.reply_to_id, message.reply_to_content_id, message.image_url,
    message.deleted_at, message.edited_at,
    message.deleted_by, message.deleted_by_role,
    coalesce(message.mentions, '[]'::jsonb) as mentions,
    case when author.id is null then null else jsonb_build_object(
      'name', author.name,
      'avatar_url', profile.avatar_url,
      'designation', case
        when experience.name is null then null
        when experience.name ~* '^heads\s+of\b' then regexp_replace(experience.name, '^heads', 'Head', 'i')
        else regexp_replace(split_part(experience.name, '(', 1), 's\s*$', '')
      end
    ) end as users,
    coalesce(reaction_groups.reactions, '[]'::jsonb) as reactions,
    case when reply.id is null then null else jsonb_build_object(
      'id', reply.id,
      'content', coalesce(reply.content, ''),
      'user_name', coalesce(reply_author.name, 'Unknown'),
      'user_id', reply.user_id
    ) end as reply_to,
    case when message.reply_to_content_id is null then null else jsonb_build_object(
      'id', message.reply_to_content_id,
      'kind', case
        when rc_thread.id is not null then 'thread'
        when rc_showcase.id is not null then 'showcase'
        when rc_resource.id is not null then 'resource'
        else 'event'
      end,
      'title', coalesce(rc_thread.title, rc_showcase.title, rc_resource.title, rc_event.title, '')
    ) end as reply_to_content,
    -- Page-level aggregate, emitted once on the first row of the page.
    case
      when row_number() over (order by message.created_at desc, message.id desc) = 1
        then coalesce(content_reaction_groups.groups, '[]'::jsonb)
      else null
    end as content_reactions
  from message_page as message
  left join public.users as author on author.id = message.user_id
  left join public.designer_profiles as profile on profile.user_id = message.user_id
  left join public.experience_levels as experience on experience.slug = profile.experience_level::text
  left join public.community_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
  left join public.community_threads as rc_thread on rc_thread.id = message.reply_to_content_id
  left join public.community_showcase_posts as rc_showcase on rc_showcase.id = message.reply_to_content_id
  left join public.community_resources as rc_resource on rc_resource.id = message.reply_to_content_id
  left join public.community_events as rc_event on rc_event.id = message.reply_to_content_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('emoji', grouped.emoji, 'user_ids', grouped.user_ids)
      order by grouped.emoji
    ) as reactions
    from (
      select reaction.emoji, jsonb_agg(reaction.user_id order by reaction.user_id) as user_ids
      from public.message_reactions as reaction
      where reaction.message_id = message.id
      group by reaction.emoji
    ) as grouped
  ) as reaction_groups on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'content_id', per_content.content_id,
        'kind', per_content.content_kind,
        'reactions', per_content.reactions
      )
      order by per_content.content_id
    ) as groups
    from (
      select
        emoji_groups.content_id,
        min(emoji_groups.content_kind) as content_kind,
        jsonb_agg(
          jsonb_build_object('emoji', emoji_groups.emoji, 'user_ids', emoji_groups.user_ids)
          order by emoji_groups.emoji
        ) as reactions
      from (
        select
          reaction.content_id,
          reaction.content_kind,
          reaction.emoji,
          jsonb_agg(reaction.user_id order by reaction.user_id) as user_ids
        from public.content_reactions as reaction
        join interesting_content as ic on ic.content_id = reaction.content_id
        group by reaction.content_id, reaction.content_kind, reaction.emoji
      ) as emoji_groups
      group by emoji_groups.content_id
    ) as per_content
  ) as content_reaction_groups on true
  where p_user_id is not null
  order by message.created_at desc, message.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_page(p_slug text)
 RETURNS TABLE(id uuid, name text, slug text, logo_url text, domain text, is_active boolean, created_at timestamp with time zone, member_count bigint, domains jsonb, members jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    domain_row.domain,
    c.is_active,
    c.created_at,
    count(distinct m.user_id) filter (where m.verified) as member_count,
    coalesce(domains.rows, '[]'::jsonb),
    coalesce(members.rows, '[]'::jsonb)
  from public.companies as c
  left join public.company_members as m on m.company_id = c.id
  left join lateral (
    -- The domain the company is DISPLAYED by (this page's picture):
    -- verified first, then the directory's most confident hint, the
    -- same ordering search_companies and get_user_company use.
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc,
             public.company_confidence_rank(d.evidence_confidence) desc,
             d.created_at asc,
             d.domain asc
    limit 1
  ) as domain_row on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('domain', d.domain, 'verified_at', d.verified_at)
      order by d.created_at asc
    ) as rows
    from public.company_domains as d
    where d.company_id = c.id and d.verified
  ) as domains on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('name', u.name, 'avatar_url', p.avatar_url, 'joined_at', m2.joined_at)
      order by m2.joined_at desc
    ) as rows
    from (
      select m2.company_id, m2.user_id, m2.joined_at
      from public.company_members as m2
      where m2.company_id = c.id and m2.verified
      order by m2.joined_at desc
      limit 8
    ) as m2
    join public.users as u on u.id = m2.user_id
    left join public.designer_profiles as p on p.user_id = m2.user_id
  ) as members on true
  where c.slug = lower(btrim(p_slug))
  group by c.id, c.name, c.slug, c.logo_url, domain_row.domain, c.is_active, c.created_at, domains.rows, members.rows;
$function$;

CREATE OR REPLACE FUNCTION public.get_dm_conversations(p_user_id uuid)
 RETURNS TABLE(conversation_id uuid, peer jsonb, last_message jsonb, unread_count integer, my_last_read_at timestamp with time zone, last_message_at timestamp with time zone, last_reaction jsonb, request_state text, requested_by uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    select c.id,
           c.last_message_at,
           c.request_state,
           c.requested_by,
           case when c.user_a = p_user_id then c.user_b else c.user_a end as peer_id,
           case when c.user_a = p_user_id then c.user_a_last_read_at
                else c.user_b_last_read_at end as my_last_read_at
      from public.dm_conversations c
     where (c.user_a = p_user_id or c.user_b = p_user_id)
       and c.last_message_at is not null
       and c.request_state <> 'rejected'
       and not exists (
         select 1
           from public.dm_blocks b
          where b.blocker_id = p_user_id
            and b.blocked_id = (case when c.user_a = p_user_id then c.user_b else c.user_a end)
       )
     order by c.last_message_at desc
     limit 200
  ),
  -- Newest reaction per conversation, with its reactor and the reacted
  -- message's body — the sidebar row shows all three ("John reacted ❤️ to:
  -- \"ok\""). Only the viewer's own conversations are considered, so the
  -- projection never reaches outside the list it feeds.
  latest_reactions as (
    select distinct on (reaction.conversation_id)
      reaction.conversation_id,
      reaction.message_id,
      reaction.user_id,
      reaction.emoji,
      reaction.created_at,
      reactor.name as reactor_name,
      message.content as message_content,
      message.image_url as message_image_url
      from public.dm_message_reactions reaction
      join public.dm_messages message on message.id = reaction.message_id
      left join public.users reactor on reactor.id = reaction.user_id
     where reaction.conversation_id in (select mine.id from mine)
     order by reaction.conversation_id, reaction.created_at desc, reaction.message_id desc
  )
  select
    mine.id,
    case when peer.id is null then null else jsonb_build_object(
      'id', peer.id,
      'name', peer.name,
      'avatar_url', peer_profile.avatar_url
    ) end as peer,
    case when last_msg.id is null then null else jsonb_build_object(
      'id', last_msg.id,
      'content', last_msg.content,
      'image_url', last_msg.image_url,
      'created_at', last_msg.created_at,
      'user_id', last_msg.user_id,
      'deleted_at', last_msg.deleted_at,
      'edited_at', last_msg.edited_at
    ) end as last_message,
    coalesce(unread.cnt, 0)::integer as unread_count,
    mine.my_last_read_at,
    mine.last_message_at,
    case
      when reaction.message_id is null then null
      -- A message newer than the reaction takes the preview line back.
      when last_msg.created_at is not null and reaction.created_at <= last_msg.created_at then null
      else jsonb_build_object(
        'message_id', reaction.message_id,
        'user_id', reaction.user_id,
        'emoji', reaction.emoji,
        'created_at', reaction.created_at,
        'reactor_name', reaction.reactor_name,
        'message_content', reaction.message_content,
        'has_image', reaction.message_image_url is not null
      )
    end as last_reaction,
    mine.request_state,
    mine.requested_by
  from mine
  left join lateral (
    select m.id, m.content, m.image_url, m.created_at, m.user_id,
           m.deleted_at, m.edited_at
      from public.dm_messages m
     where m.conversation_id = mine.id
     order by m.created_at desc, m.id desc
     limit 1
  ) as last_msg on true
  left join lateral (
    select count(*) as cnt
      from public.dm_messages m
     where m.conversation_id = mine.id
       and m.user_id <> p_user_id
       and m.created_at > coalesce(mine.my_last_read_at, '-infinity'::timestamptz)
  ) as unread on true
  left join latest_reactions reaction on reaction.conversation_id = mine.id
  left join public.users as peer on peer.id = mine.peer_id
  left join public.designer_profiles as peer_profile on peer_profile.user_id = mine.peer_id
  order by mine.last_message_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_dm_message_page(p_conversation_id uuid, p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, content text, created_at timestamp with time zone, user_id uuid, reply_to_id uuid, image_url text, deleted_at timestamp with time zone, edited_at timestamp with time zone, users jsonb, reactions jsonb, reply_to jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with participant as (
    select 1
      from public.dm_conversations c
     where c.id = p_conversation_id
       and (c.user_a = p_user_id or c.user_b = p_user_id)
  ),
  message_page as materialized (
    (
      select m.id, m.content, m.created_at, m.user_id, m.reply_to_id,
             m.image_url, m.deleted_at, m.edited_at
        from public.dm_messages m
       where p_after is not null
         and m.conversation_id = p_conversation_id
         and (m.created_at, m.id) > (p_after, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
         and exists (select 1 from participant)
       order by m.created_at asc, m.id asc
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    union all
    (
      select m.id, m.content, m.created_at, m.user_id, m.reply_to_id,
             m.image_url, m.deleted_at, m.edited_at
        from public.dm_messages m
       where p_after is null
         and m.conversation_id = p_conversation_id
         and (p_before is null or (m.created_at, m.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
         and exists (select 1 from participant)
       order by m.created_at desc, m.id desc
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
  )
  select
    message.id, message.content, message.created_at, message.user_id,
    message.reply_to_id, message.image_url, message.deleted_at,
    message.edited_at,
    case when author.id is null then null else jsonb_build_object(
      'name', author.name,
      'avatar_url', author_profile.avatar_url
    ) end as users,
    coalesce(reaction_groups.reactions, '[]'::jsonb) as reactions,
    case when reply.id is null then null else jsonb_build_object(
      'id', reply.id,
      'content', coalesce(reply.content, ''),
      'user_name', coalesce(reply_author.name, 'Unknown'),
      'user_id', reply.user_id
    ) end as reply_to
  from message_page as message
  left join public.users as author on author.id = message.user_id
  left join public.designer_profiles as author_profile on author_profile.user_id = message.user_id
  left join public.dm_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('emoji', grouped.emoji, 'user_ids', grouped.user_ids)
      order by grouped.emoji
    ) as reactions
    from (
      select reaction.emoji, jsonb_agg(reaction.user_id order by reaction.user_id) as user_ids
        from public.dm_message_reactions as reaction
       where reaction.message_id = message.id
       group by reaction.emoji
    ) as grouped
  ) as reaction_groups on true
  order by message.created_at desc, message.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_dm_unread_total(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.dm_conversations c
   where (c.user_a = p_user_id or c.user_b = p_user_id)
     and c.request_state <> 'rejected'
     and not exists (
       select 1
         from public.dm_blocks b
        where b.blocker_id = p_user_id
          and b.blocked_id = (case when c.user_a = p_user_id then c.user_b else c.user_a end)
     )
     and exists (
       select 1
         from public.dm_messages m
        where m.conversation_id = c.id
          and m.user_id <> p_user_id
          and m.created_at > coalesce(
                case when c.user_a = p_user_id then c.user_a_last_read_at
                     else c.user_b_last_read_at end,
                '-infinity'::timestamptz
              )
     );
$function$;

CREATE OR REPLACE FUNCTION public.get_event_attendee_previews(p_event_ids uuid[], p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, rsvps jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    event.id,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', attendee.event_id,
          'user_id', attendee.user_id,
          'created_at', attendee.created_at,
          'users', case
            when attendee.name is null then null
            else jsonb_build_object(
              'name', attendee.name,
              'avatar_url', attendee.avatar_url
            )
          end
        )
        order by attendee.created_at asc
      ) filter (where attendee.user_id is not null),
      '[]'::jsonb
    ) as rsvps
  from unnest(coalesce(p_event_ids, '{}'::uuid[])) as event(id)
  left join lateral (
    select
      er.event_id,
      er.user_id,
      er.created_at,
      u.name,
      dp.avatar_url
    from public.event_rsvps er
    left join public.users u on u.id = er.user_id
    left join public.designer_profiles dp on dp.user_id = er.user_id
    where er.event_id = event.id
    order by er.created_at asc
    limit least(greatest(p_limit, 1), 5)
  ) attendee on true
  group by event.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_list_aggregates(p_user_id uuid, p_event_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(id uuid, rsvp_count bigint, like_count bigint, save_count bigint, user_rsvped boolean, user_liked boolean, user_saved boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with requested as (
    select distinct requested_id as id
    from unnest(coalesce(p_event_ids, '{}'::uuid[])) as input(requested_id)
  ),
  rsvps as (
    select r.event_id as id,
      count(*) as rsvp_count,
      bool_or(r.user_id = p_user_id) as user_rsvped
    from public.event_rsvps as r
    where r.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by r.event_id
  ),
  likes as (
    select l.event_id as id,
      count(*) as like_count,
      bool_or(l.user_id = p_user_id) as user_liked
    from public.event_likes as l
    where l.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by l.event_id
  ),
  saves as (
    select s.event_id as id,
      count(*) as save_count,
      bool_or(s.user_id = p_user_id) as user_saved
    from public.event_saves as s
    where s.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by s.event_id
  )
  select requested.id,
    coalesce(rsvps.rsvp_count, 0),
    coalesce(likes.like_count, 0),
    coalesce(saves.save_count, 0),
    coalesce(rsvps.user_rsvped, false),
    coalesce(likes.user_liked, false),
    coalesce(saves.user_saved, false)
  from requested
  left join rsvps using (id)
  left join likes using (id)
  left join saves using (id);
$function$;

CREATE OR REPLACE FUNCTION public.get_event_list_page(p_community_id uuid, p_user_id uuid, p_phase text DEFAULT 'upcoming'::text, p_cursor_event_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 26)
 RETURNS TABLE(item jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_user_id
  ) then
    raise insufficient_privilege using message = 'Not a member of this community.';
  end if;
  if p_phase not in ('upcoming', 'past') then
    raise invalid_parameter_value using message = 'Invalid event phase.';
  end if;

  return query
  with page as (
    select e.*
    from public.community_events e
    where e.community_id = p_community_id
      and case when p_phase = 'upcoming'
        then coalesce(e.end_date, e.event_date) >= p_now
          and (p_cursor_event_date is null or (e.event_date, e.id) > (p_cursor_event_date, p_cursor_id))
        else coalesce(e.end_date, e.event_date) < p_now
          and (p_cursor_event_date is null or (e.event_date, e.id) < (p_cursor_event_date, p_cursor_id))
      end
    order by
      case when p_phase = 'upcoming' then e.event_date end asc,
      case when p_phase = 'upcoming' then e.id end asc,
      case when p_phase = 'past' then e.event_date end desc,
      case when p_phase = 'past' then e.id end desc
    limit least(greatest(p_limit, 1), 26)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'rsvp_count', (select count(*) from public.event_rsvps r where r.event_id = p.id),
    'like_count', (select count(*) from public.event_likes l where l.event_id = p.id),
    'save_count', (select count(*) from public.event_saves s where s.event_id = p.id),
    'user_rsvped', exists(select 1 from public.event_rsvps r where r.event_id = p.id and r.user_id = p_user_id),
    'user_liked', exists(select 1 from public.event_likes l where l.event_id = p.id and l.user_id = p_user_id),
    'user_saved', exists(select 1 from public.event_saves s where s.event_id = p.id and s.user_id = p_user_id)
  ) - 'is_public'
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by
    case when p_phase = 'upcoming' then p.event_date end asc,
    case when p_phase = 'upcoming' then p.id end asc,
    case when p_phase = 'past' then p.event_date end desc,
    case when p_phase = 'past' then p.id end desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_home_feed_interactions(p_user_id uuid, p_thread_ids uuid[] DEFAULT '{}'::uuid[], p_event_ids uuid[] DEFAULT '{}'::uuid[], p_resource_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with
  thread_ids as (
    select distinct id
    from unnest(coalesce(p_thread_ids, '{}'::uuid[])) as requested(id)
  ),
  thread_comment_counts as (
    select comments.thread_id as id, count(*) as comment_count
    from public.thread_comments as comments
    where comments.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by comments.thread_id
  ),
  thread_like_counts as (
    select likes.thread_id as id,
      count(*) as like_count,
      bool_or(likes.user_id = p_user_id) as user_liked
    from public.thread_likes as likes
    where likes.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by likes.thread_id
  ),
  thread_save_state as (
    select saves.thread_id as id,
      bool_or(saves.user_id = p_user_id) as user_saved
    from public.thread_saves as saves
    where saves.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by saves.thread_id
  ),
  thread_interactions as (
    select coalesce(jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', coalesce(comments.comment_count, 0),
      'like_count', coalesce(likes.like_count, 0),
      'user_liked', coalesce(likes.user_liked, false),
      'user_saved', coalesce(saves.user_saved, false)
    )), '{}'::jsonb) as value
    from thread_ids as ids
    left join thread_comment_counts as comments using (id)
    left join thread_like_counts as likes using (id)
    left join thread_save_state as saves using (id)
  ),
  event_ids as (
    select distinct id
    from unnest(coalesce(p_event_ids, '{}'::uuid[])) as requested(id)
  ),
  event_comment_counts as (
    select comments.event_id as id, count(*) as comment_count
    from public.event_comments as comments
    where comments.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by comments.event_id
  ),
  event_rsvp_counts as (
    select rsvps.event_id as id,
      count(*) as rsvp_count,
      bool_or(rsvps.user_id = p_user_id) as user_rsvped
    from public.event_rsvps as rsvps
    where rsvps.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by rsvps.event_id
  ),
  event_like_counts as (
    select likes.event_id as id,
      count(*) as like_count,
      bool_or(likes.user_id = p_user_id) as user_liked
    from public.event_likes as likes
    where likes.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by likes.event_id
  ),
  event_save_counts as (
    select saves.event_id as id,
      count(*) as save_count,
      bool_or(saves.user_id = p_user_id) as user_saved
    from public.event_saves as saves
    where saves.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by saves.event_id
  ),
  event_interactions as (
    select coalesce(jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', coalesce(comments.comment_count, 0),
      'rsvp_count', coalesce(rsvps.rsvp_count, 0),
      'user_rsvped', coalesce(rsvps.user_rsvped, false),
      'like_count', coalesce(likes.like_count, 0),
      'user_liked', coalesce(likes.user_liked, false),
      'save_count', coalesce(saves.save_count, 0),
      'user_saved', coalesce(saves.user_saved, false)
    )), '{}'::jsonb) as value
    from event_ids as ids
    left join event_comment_counts as comments using (id)
    left join event_rsvp_counts as rsvps using (id)
    left join event_like_counts as likes using (id)
    left join event_save_counts as saves using (id)
  ),
  resource_ids as (
    select distinct id
    from unnest(coalesce(p_resource_ids, '{}'::uuid[])) as requested(id)
  ),
  resource_comment_counts as (
    select comments.resource_id as id, count(*) as comment_count
    from public.resource_comments as comments
    where comments.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by comments.resource_id
  ),
  resource_save_counts as (
    select saves.resource_id as id,
      count(*) as save_count,
      bool_or(saves.user_id = p_user_id) as user_saved
    from public.resource_saves as saves
    where saves.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by saves.resource_id
  ),
  resource_bookmark_counts as (
    select bookmarks.resource_id as id,
      count(*) as bookmark_count,
      bool_or(bookmarks.user_id = p_user_id) as user_bookmarked
    from public.resource_bookmarks as bookmarks
    where bookmarks.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by bookmarks.resource_id
  ),
  resource_interactions as (
    select coalesce(jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', coalesce(comments.comment_count, 0),
      'save_count', coalesce(saves.save_count, 0),
      'user_saved', coalesce(saves.user_saved, false),
      'bookmark_count', coalesce(bookmarks.bookmark_count, 0),
      'user_bookmarked', coalesce(bookmarks.user_bookmarked, false)
    )), '{}'::jsonb) as value
    from resource_ids as ids
    left join resource_comment_counts as comments using (id)
    left join resource_save_counts as saves using (id)
    left join resource_bookmark_counts as bookmarks using (id)
  )
  select jsonb_build_object(
    'threads', (select value from thread_interactions),
    'events', (select value from event_interactions),
    'resources', (select value from resource_interactions)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_home_feed_page(p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where t.is_public = true and t.community_id is not null
      and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where e.is_public = true and e.community_id is not null
      and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where r.is_public = true and r.community_id is not null
      and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where s.is_public = true and s.community_id is not null
      and (p_before is null or s.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 30)
  )
  select p.payload || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', c.image_url,
    'comment_count', case p.kind
      when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
      when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  order by p.created_at desc, p.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_home_feed_page(p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30, p_member_only boolean DEFAULT false)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select *
  from public.get_home_feed_page(
    p_user_id,
    p_before,
    p_limit,
    (case when p_member_only then 'communities' else 'all' end)::text
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_home_feed_page(p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30, p_scope text DEFAULT 'all'::text)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with my_communities as (
    select m.community_id
    from public.community_members m
    where m.user_id = p_user_id
  ), candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where t.community_id is not null
      and case p_scope
        when 'communities' then t.community_id in (select community_id from my_communities)
        when 'public' then t.is_public and t.community_id not in (select community_id from my_communities)
        else (t.community_id in (select community_id from my_communities) or t.is_public)
      end
      and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where e.community_id is not null
      and case p_scope
        when 'communities' then e.community_id in (select community_id from my_communities)
        when 'public' then e.is_public and e.community_id not in (select community_id from my_communities)
        else (e.community_id in (select community_id from my_communities) or e.is_public)
      end
      and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where r.community_id is not null
      and case p_scope
        when 'communities' then r.community_id in (select community_id from my_communities)
        when 'public' then r.is_public and r.community_id not in (select community_id from my_communities)
        else (r.community_id in (select community_id from my_communities) or r.is_public)
      end
      and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where s.community_id is not null
      and case p_scope
        when 'communities' then s.community_id in (select community_id from my_communities)
        when 'public' then s.is_public and s.community_id not in (select community_id from my_communities)
        else (s.community_id in (select community_id from my_communities) or s.is_public)
      end
      and (p_before is null or s.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 30)
  )
  select p.payload || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
    'comment_count', case p.kind
      when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
      when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  left join public.cities city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by p.created_at desc, p.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_job_applicants(p_poster_id uuid, p_job_id uuid)
 RETURNS TABLE(item jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.job_posts as jp
    where jp.id = p_job_id and jp.poster_id = p_poster_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_your_job';
  end if;

  return query
  select jsonb_build_object(
    'id', ja.id,
    'applicant_id', ja.applicant_id,
    'name', ja.name,
    'portfolio_url', ja.portfolio_url,
    'linkedin_url', ja.linkedin_url,
    'resume_url', ja.resume_url,
    'resume_key', ja.resume_key,
    'created_at', ja.created_at,
    'avatar_url', dp.avatar_url,
    'status', ja.status
  )
  from public.job_applications as ja
  left join public.designer_profiles as dp on dp.user_id = ja.applicant_id
  where ja.job_id = p_job_id
  order by ja.created_at desc, ja.id desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_job_detail(p_job_id uuid, p_viewer_id uuid)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select public.job_post_payload(p_job_id, p_viewer_id) as item
  where exists (select 1 from public.job_posts as jp where jp.id = p_job_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_job_feed(p_viewer_id uuid, p_limit integer DEFAULT 50, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select public.job_post_payload(p.job_id, p_viewer_id) as item
  from (
    select jp.id as job_id, jp.created_at
    from public.job_posts as jp
    where (public.job_post_is_open(jp.status, jp.closes_at)
           or jp.poster_id = p_viewer_id)
      and (p_before_created_at is null
           or (jp.created_at, jp.id) < (p_before_created_at, p_before_id))
    order by jp.created_at desc, jp.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) as p
  order by p.created_at desc, p.job_id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_library_page(p_user_id uuid)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with my_communities as (
    select m.community_id
    from public.community_members as m
    where m.user_id = p_user_id
  ), candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at,
           li.featured_rank as rank, to_jsonb(t) as payload
    from public.library_items as li
    join public.community_threads as t on t.id = li.thread_id
    where t.community_id is not null
      and (t.is_public or t.community_id in (select community_id from my_communities))
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, li.featured_rank, to_jsonb(s)
    from public.library_items as li
    join public.community_showcase_posts as s on s.id = li.showcase_id
    where s.community_id is not null
      and (s.is_public or s.community_id in (select community_id from my_communities))
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, li.featured_rank, to_jsonb(r)
    from public.library_items as li
    join public.community_resources as r on r.id = li.resource_id
    where r.community_id is not null
      and (r.is_public or r.community_id in (select community_id from my_communities))
  )
  select p.payload || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
    'comment_count', case p.kind
      when 'thread'   then (select count(*) from public.thread_comments as x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments as x where x.resource_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments as x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes as x where x.thread_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes as x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes as x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes as x where x.post_id = p.id and x.user_id = p_user_id)),
    'save_count', case
      when p.kind = 'resource' then (select count(*) from public.resource_saves as x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves as x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread'   then exists(select 1 from public.thread_saves as x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves as x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves as x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks as x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks as x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from candidates as p
  left join public.users as u on u.id = p.user_id
  left join public.designer_profiles as dp on dp.user_id = p.user_id
  left join public.communities as c on c.id = p.community_id
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles as job
    on c.type = 'job_title' and job.id = c.reference_id
  order by case p.kind when 'thread' then 0 when 'showcase' then 1 else 2 end,
           p.rank asc,
           p.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_member_feed_page(p_viewer_id uuid, p_author_id uuid, p_scope text DEFAULT 'all'::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with my_communities as (
    select m.community_id
    from public.community_members m
    where m.user_id = p_viewer_id
  ), candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where p_scope in ('all', 'thread')
      and t.user_id = p_author_id
      and t.community_id is not null
      and (t.is_public or t.community_id in (select community_id from my_communities))
      and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where p_scope in ('all', 'event')
      and e.user_id = p_author_id
      and e.community_id is not null
      and (e.is_public or e.community_id in (select community_id from my_communities))
      and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where p_scope in ('all', 'resource')
      and r.user_id = p_author_id
      and r.community_id is not null
      and (r.is_public or r.community_id in (select community_id from my_communities))
      and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where p_scope in ('all', 'showcase')
      and s.user_id = p_author_id
      and s.community_id is not null
      and (s.is_public or s.community_id in (select community_id from my_communities))
      and (p_before is null or s.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50)
  )
  select p.payload || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
    'comment_count', case p.kind
      when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
      when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_viewer_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_viewer_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_viewer_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_viewer_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_viewer_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_viewer_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_viewer_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_viewer_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_viewer_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  left join public.cities city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by p.created_at desc, p.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_dm_conversation(p_me uuid, p_peer uuid)
 RETURNS TABLE(id uuid, user_a uuid, user_b uuid, created_at timestamp with time zone, last_message_at timestamp with time zone, my_last_read_at timestamp with time zone, request_state text, requested_by uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- The ON CONFLICT target names columns that are also OUT parameter names
-- (user_a/user_b of the returned row); resolve those references as columns.
#variable_conflict use_column
declare
  pair_a uuid := least(p_me, p_peer);
  pair_b uuid := greatest(p_me, p_peer);
  v_existing uuid;
begin
  if p_me = p_peer then
    raise exception 'Cannot start a conversation with yourself' using errcode = '22023';
  end if;

  select c.id into v_existing
    from public.dm_conversations as c
   where c.user_a = pair_a
     and c.user_b = pair_b;

  if v_existing is null then
    insert into public.dm_conversations (user_a, user_b, request_state)
    values (pair_a, pair_b, 'pending')
    on conflict (user_a, user_b) do nothing;

    -- The row was genuinely created (not raced onto an existing pair), so
    -- this counts as one of the starter's new conversations this month. The
    -- counter refuses past the cap and rolls the insert back with it; two
    -- parallel creates serialize on the counter row, so the cap holds even
    -- under a burst (see the creation-limits migration).
    if found then
      perform public.bump_usage_counter(p_me, 'dms_monthly');
    end if;
  end if;

  return query
    select c.id, c.user_a, c.user_b, c.created_at, c.last_message_at,
           case when c.user_a = p_me then c.user_a_last_read_at
                else c.user_b_last_read_at end,
           c.request_state,
           c.requested_by
      from public.dm_conversations c
     where c.user_a = pair_a
       and c.user_b = pair_b;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_company_verification(p_user_id uuid, p_verification_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(verification_id uuid, company_id uuid, company_name text, domain text, work_email text, attempts_left integer, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    v.id,
    v.company_id,
    v.company_name,
    v.domain,
    v.work_email,
    greatest(5 - v.attempts, 0),
    v.expires_at,
    v.created_at
  from public.company_email_verifications as v
  where v.user_id = p_user_id
    and case
      when p_verification_id is null then v.consumed_at is null and v.expires_at > now()
      else v.id = p_verification_id
    end
  order by v.created_at desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_profile_feed_page(p_user_id uuid, p_scope text DEFAULT 'all'::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30)
 RETURNS TABLE(item jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with candidates as (
    -- ── Authored: 'all' and the kind scopes ────────────────────────────────
    -- One branch per kind, index-driven on (author, recency) — never a
    -- sequential scan of every card table.

    -- ── Threads ────────────────────────────────────────────────────────────
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where p_scope in ('all', 'thread') and t.user_id = p_user_id and t.community_id is not null
    union all
    -- ── Events ─────────────────────────────────────────────────────────────
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where p_scope in ('all', 'event') and e.user_id = p_user_id and e.community_id is not null
    union all
    -- ── Resources ──────────────────────────────────────────────────────────
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where p_scope in ('all', 'resource') and r.user_id = p_user_id and r.community_id is not null
    union all
    -- ── Showcase ───────────────────────────────────────────────────────────
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.community_showcase_posts p
    where p_scope in ('all', 'showcase') and p.user_id = p_user_id and p.community_id is not null
    union all
    -- ── Saved: the Saved tab alone ─────────────────────────────────────────
    -- The resource card's Save is the bookmark — resource_saves is the heart,
    -- and a heart is not a save (see 20261010170000).
    select 'thread', t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t)
    from public.thread_saves s
    join public.community_threads t on t.id = s.thread_id
    where p_scope = 'saved' and s.user_id = p_user_id and t.community_id is not null
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.event_saves s
    join public.community_events e on e.id = s.event_id
    where p_scope = 'saved' and s.user_id = p_user_id and e.community_id is not null
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.resource_bookmarks s
    join public.community_resources r on r.id = s.resource_id
    where p_scope = 'saved' and s.user_id = p_user_id and r.community_id is not null
    union all
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.showcase_saves s
    join public.community_showcase_posts p on p.id = s.post_id
    where p_scope = 'saved' and s.user_id = p_user_id and p.community_id is not null
  ), page as (
    select * from candidates
    where p_before is null or candidates.created_at < p_before
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50)
  )
  -- Projection mirrors public.get_home_feed_page exactly: the profile cards
  -- and the homepage cards are rendered by the same client components. The
  -- community display picture resolves the master-data row first (via
  -- communities.reference_id), stored communities.image_url as fallback.
  select p.payload || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
    'comment_count', case p.kind
      when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
      when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  left join public.cities city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by p.created_at desc, p.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_resource_list_aggregates(p_user_id uuid, p_resource_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(id uuid, save_count bigint, comment_count bigint, bookmark_count bigint, user_saved boolean, user_bookmarked boolean, allow_replies boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with requested as (
    select distinct requested_id as id
    from unnest(coalesce(p_resource_ids, '{}'::uuid[])) as input(requested_id)
  ),
  saves as (
    select s.resource_id as id,
      count(*) as save_count,
      bool_or(s.user_id = p_user_id) as user_saved
    from public.resource_saves as s
    where s.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by s.resource_id
  ),
  comments as (
    select c.resource_id as id, count(*) as comment_count
    from public.resource_comments as c
    where c.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by c.resource_id
  ),
  bookmarks as (
    select b.resource_id as id,
      count(*) as bookmark_count,
      bool_or(b.user_id = p_user_id) as user_bookmarked
    from public.resource_bookmarks as b
    where b.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by b.resource_id
  ),
  resources as (
    select r.id,
      bool_or(r.allow_replies = true) as allow_replies
    from public.community_resources r
    where r.id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by r.id
  )
  select requested.id,
    coalesce(saves.save_count, 0),
    coalesce(comments.comment_count, 0),
    coalesce(bookmarks.bookmark_count, 0),
    coalesce(saves.user_saved, false),
    coalesce(bookmarks.user_bookmarked, false),
    coalesce(resources.allow_replies, false)
  from requested
  left join saves using (id)
  left join comments using (id)
  left join bookmarks using (id)
  left join resources using (id);
$function$;

CREATE OR REPLACE FUNCTION public.get_resource_list_page(p_community_id uuid, p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(item jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_user_id
  ) then
    raise insufficient_privilege using message = 'Not a member of this community.';
  end if;

  return query
  with page as (
    select r.*
    from public.community_resources r
    where r.community_id = p_community_id
      and (p_before is null or (r.created_at, r.id) < (p_before, p_cursor_id))
    order by r.created_at desc, r.id desc
    limit least(greatest(p_limit, 1), 200)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'save_count', (select count(*) from public.resource_saves s where s.resource_id = p.id),
    'comment_count', (select count(*) from public.resource_comments c where c.resource_id = p.id),
    'bookmark_count', (select count(*) from public.resource_bookmarks b where b.resource_id = p.id),
    'user_saved', exists(select 1 from public.resource_saves s where s.resource_id = p.id and s.user_id = p_user_id),
    'user_bookmarked', exists(select 1 from public.resource_bookmarks b where b.resource_id = p.id and b.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_showcase_interactions(p_user_id uuid, p_post_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with ids as (
    select distinct id from unnest(coalesce(p_post_ids, '{}'::uuid[])) requested(id)
  ), likes as (
    select post_id as id, count(*)::integer as like_count,
      bool_or(user_id = p_user_id) as user_liked
    from public.showcase_likes where post_id = any(coalesce(p_post_ids, '{}'::uuid[]))
    group by post_id
  ), saves as (
    select post_id as id, bool_or(user_id = p_user_id) as user_saved
    from public.showcase_saves where post_id = any(coalesce(p_post_ids, '{}'::uuid[]))
    group by post_id
  ), comments as (
    select post_id as id, count(*)::integer as comment_count
    from public.showcase_comments where post_id = any(coalesce(p_post_ids, '{}'::uuid[]))
    group by post_id
  )
  select coalesce(jsonb_object_agg(ids.id, jsonb_build_object(
    'like_count', coalesce(likes.like_count, 0),
    'comment_count', coalesce(comments.comment_count, 0),
    'user_liked', coalesce(likes.user_liked, false),
    'user_saved', coalesce(saves.user_saved, false)
  )), '{}'::jsonb)
  from ids
  left join likes using (id)
  left join saves using (id)
  left join comments using (id);
$function$;

CREATE OR REPLACE FUNCTION public.get_showcase_list_page(p_community_id uuid, p_user_id uuid, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 26)
 RETURNS TABLE(id uuid, community_id uuid, user_id uuid, title text, image_url text, attachments jsonb, category text, is_public boolean, allow_replies boolean, created_at timestamp with time zone, updated_at timestamp with time zone, author jsonb, like_count integer, comment_count integer, user_liked boolean, user_saved boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with page as (
    select post.*
    from public.community_showcase_posts as post
    where post.community_id = p_community_id
      and (
        p_cursor_created_at is null
        or post.created_at < p_cursor_created_at
        or (post.created_at = p_cursor_created_at and post.id < p_cursor_id)
      )
    order by post.created_at desc, post.id desc
    limit greatest(0, least(coalesce(p_limit, 26), 100))
  ),
  likes as (
    select showcase_like.post_id,
      count(*)::integer as like_count,
      bool_or(showcase_like.user_id = p_user_id) as user_liked
    from public.showcase_likes as showcase_like
    where showcase_like.post_id in (select page.id from page)
    group by showcase_like.post_id
  ),
  saves as (
    select showcase_save.post_id,
      bool_or(showcase_save.user_id = p_user_id) as user_saved
    from public.showcase_saves as showcase_save
    where showcase_save.post_id in (select page.id from page)
    group by showcase_save.post_id
  ),
  comments as (
    select showcase_comment.post_id, count(*)::integer as comment_count
    from public.showcase_comments as showcase_comment
    where showcase_comment.post_id in (select page.id from page)
    group by showcase_comment.post_id
  )
  select
    page.id,
    page.community_id,
    page.user_id,
    page.title,
    page.image_url,
    page.attachments,
    page.category,
    page.is_public,
    page.allow_replies,
    page.created_at,
    page.updated_at,
    jsonb_build_object(
      'name', coalesce(showcase_author.name, 'Community member'),
      'avatar_url', showcase_profile.avatar_url
    ) as author,
    coalesce(likes.like_count, 0) as like_count,
    coalesce(comments.comment_count, 0) as comment_count,
    coalesce(likes.user_liked, false) as user_liked,
    coalesce(saves.user_saved, false) as user_saved
  from page
  left join public.users as showcase_author on showcase_author.id = page.user_id
  left join public.designer_profiles as showcase_profile on showcase_profile.user_id = page.user_id
  left join likes on likes.post_id = page.id
  left join saves on saves.post_id = page.id
  left join comments on comments.post_id = page.id
  order by page.created_at desc, page.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_sidebar_activity(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with memberships as (
    select
      cm.community_id,
      cm.joined_at,
      cm.last_read_at,
      cm.archived_at,
      -- The materialized counter (see 20260927120000_community_member_count.sql),
      -- so displaying it never scans the community's membership rows.
      coalesce(c.member_count, 0) as member_count,
      -- Where counting can start: everything before this is already read (or
      -- predates the membership), so it can never contribute to unread.
      greatest(cm.last_read_at, cm.joined_at) as unread_since,
      (c.enabled_tabs is null or 'threads' = any (c.enabled_tabs)) as threads_enabled,
      (c.enabled_tabs is null or 'events' = any (c.enabled_tabs)) as events_enabled,
      (c.enabled_tabs is null or 'resources' = any (c.enabled_tabs)) as resources_enabled,
      coalesce(c.showcase_enabled, true) as showcase_enabled
    from public.community_members cm
    join public.communities c on c.id = cm.community_id
    where cm.user_id = p_user_id
  ),
  message_stats as (
    select m.community_id,
      count(*)::integer as unread_count,
      count(*) filter (
        where exists (
          select 1
          from jsonb_array_elements(coalesce(m.mentions, '[]'::jsonb)) as mentioned
          where mentioned ->> 'user_id' = p_user_id::text
        )
      )::integer as unread_mention_count
    from public.community_messages m
    join memberships membership on membership.community_id = m.community_id
    where m.user_id <> p_user_id
      and m.created_at > membership.unread_since
    group by m.community_id
  ),
  -- Newest message per community: one index step per community instead of a
  -- distinct-on over everything since the member joined.
  latest_messages as (
    select
      membership.community_id, latest.id, latest.content, latest.created_at, latest.user_id,
      latest.reply_to_id, latest.reply_to_content_id, latest.deleted_at, latest.image_url,
      sender.name as sender_name, parent_sender.name as reply_sender_name
    from memberships membership
    left join lateral (
      select m.id, m.content, m.created_at, m.user_id, m.reply_to_id,
             m.reply_to_content_id, m.deleted_at, m.image_url
      from public.community_messages m
      where m.community_id = membership.community_id
        and m.created_at > membership.joined_at
      order by m.created_at desc, m.id desc
      limit 1
    ) latest on true
    left join public.users sender on sender.id = latest.user_id
    left join public.community_messages parent on parent.id = latest.reply_to_id
    left join public.users parent_sender on parent_sender.id = parent.user_id
  ),
  -- Newest reaction per community, once per anchor table. content_kind is null
  -- for message reactions, so the sidebar can render a card reaction with the
  -- card's own vocabulary.
  latest_message_reaction as (
    select
      membership.community_id, reaction.message_id, reaction.user_id, reaction.emoji,
      reaction.created_at, reactor.name as reactor_name,
      message.content as message_content, message.image_url as message_image_url
    from memberships membership
    left join lateral (
      select r.message_id, r.user_id, r.emoji, r.created_at
      from public.message_reactions r
      where r.community_id = membership.community_id
        and r.created_at > membership.joined_at
      order by r.created_at desc, r.message_id desc
      limit 1
    ) reaction on true
    left join public.community_messages message on message.id = reaction.message_id
    left join public.users reactor on reactor.id = reaction.user_id
  ),
  latest_content_reaction as (
    select
      membership.community_id, reaction.content_id as message_id, reaction.content_kind,
      reaction.user_id, reaction.emoji, reaction.created_at, reactor.name as reactor_name
    from memberships membership
    left join lateral (
      select r.content_id, r.content_kind, r.user_id, r.emoji, r.created_at
      from public.content_reactions r
      where r.community_id = membership.community_id
        and r.created_at > membership.joined_at
      order by r.created_at desc, r.content_id desc
      limit 1
    ) reaction on true
    left join public.users reactor on reactor.id = reaction.user_id
  ),
  -- Only the content rows something actually points at: a reply anchor or a
  -- card reaction. Unioning all four tables unconditionally is what made a
  -- reaction preview cost a scan of every thread/showcase/resource/event.
  pinned_content_ids as (
    select latest.reply_to_content_id as id
    from latest_messages latest
    where latest.reply_to_content_id is not null
    union
    select reaction.message_id as id
    from latest_content_reaction reaction
    where reaction.message_id is not null
  ),
  content_titles as (
    select 'thread'::text as kind, t.id, t.title
    from public.community_threads t
    join pinned_content_ids pinned on pinned.id = t.id
    union all
    select 'showcase'::text, s.id, s.title
    from public.community_showcase_posts s
    join pinned_content_ids pinned on pinned.id = s.id
    union all
    select 'resource'::text, r.id, r.title
    from public.community_resources r
    join pinned_content_ids pinned on pinned.id = r.id
    union all
    select 'event'::text, e.id, e.title
    from public.community_events e
    join pinned_content_ids pinned on pinned.id = e.id
  ),
  -- Newest reaction across BOTH anchors: a chat message or a content card.
  latest_reactions as (
    select distinct on (unioned.community_id)
      unioned.community_id, unioned.message_id, unioned.user_id, unioned.emoji,
      unioned.created_at, unioned.reactor_name, unioned.message_content,
      unioned.message_image_url, unioned.content_kind
    from (
      select
        community_id, message_id, user_id, emoji, created_at, reactor_name,
        message_content, message_image_url, null::text as content_kind
      from latest_message_reaction
      where message_id is not null
      union all
      select
        reaction.community_id, reaction.message_id, reaction.user_id, reaction.emoji,
        reaction.created_at, reaction.reactor_name, card.title as message_content,
        null::text as message_image_url, reaction.content_kind
      from latest_content_reaction reaction
      left join content_titles card
        on card.id = reaction.message_id and card.kind = reaction.content_kind
      where reaction.message_id is not null
    ) unioned
    order by unioned.community_id, unioned.created_at desc, unioned.message_id desc
  ),
  -- Unread content: bounded by the same watermark as the message counts, and
  -- skipped entirely for areas the community has disabled.
  content_items as (
    select membership.community_id, t.user_id, t.created_at
    from memberships membership
    join public.community_threads t on t.community_id = membership.community_id
    where membership.threads_enabled and t.created_at > membership.unread_since
    union all
    select membership.community_id, s.user_id, s.created_at
    from memberships membership
    join public.community_showcase_posts s on s.community_id = membership.community_id
    where membership.showcase_enabled and s.created_at > membership.unread_since
    union all
    select membership.community_id, r.user_id, r.created_at
    from memberships membership
    join public.community_resources r on r.community_id = membership.community_id
    where membership.resources_enabled and r.created_at > membership.unread_since
    union all
    select membership.community_id, e.user_id, e.created_at
    from memberships membership
    join public.community_events e on e.community_id = membership.community_id
    where membership.events_enabled and e.created_at > membership.unread_since
  ),
  content_stats as (
    select item.community_id,
      count(*)::integer as unread_content_count
    from content_items item
    where item.user_id <> p_user_id
    group by item.community_id
  ),
  -- Newest content item per community — preview only, so it keeps showing the
  -- newest item even after it has been read.
  latest_content as (
    select
      membership.community_id, content_item.id, content_item.kind, content_item.title,
      content_item.created_at, content_item.user_id, author.name as author_name
    from memberships membership
    left join lateral (
      select candidate.kind, candidate.id, candidate.title, candidate.created_at, candidate.user_id
      from (
        (select 'thread'::text as kind, t.id, t.title, t.created_at, t.user_id
         from public.community_threads t
         where membership.threads_enabled
           and t.community_id = membership.community_id
           and t.created_at > membership.joined_at
         order by t.created_at desc, t.id desc
         limit 1)
        union all
        (select 'showcase'::text, s.id, s.title, s.created_at, s.user_id
         from public.community_showcase_posts s
         where membership.showcase_enabled
           and s.community_id = membership.community_id
           and s.created_at > membership.joined_at
         order by s.created_at desc, s.id desc
         limit 1)
        union all
        (select 'resource'::text, r.id, r.title, r.created_at, r.user_id
         from public.community_resources r
         where membership.resources_enabled
           and r.community_id = membership.community_id
           and r.created_at > membership.joined_at
         order by r.created_at desc, r.id desc
         limit 1)
        union all
        (select 'event'::text, e.id, e.title, e.created_at, e.user_id
         from public.community_events e
         where membership.events_enabled
           and e.community_id = membership.community_id
           and e.created_at > membership.joined_at
         order by e.created_at desc, e.id desc
         limit 1)
      ) candidate
      order by candidate.created_at desc, candidate.id desc
      limit 1
    ) content_item on true
    left join public.users author on author.id = content_item.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'community_id', membership.community_id,
    'joined_at', membership.joined_at,
    'last_read_at', membership.last_read_at,
    'archived_at', membership.archived_at,
    'member_count', membership.member_count,
    'unread_count', coalesce(stats.unread_count, 0),
    'unread_mention_count', coalesce(stats.unread_mention_count, 0),
    'unread_content_count', coalesce(content.unread_content_count, 0),
    'last_message', case when latest.id is null then null else jsonb_build_object(
      'id', latest.id, 'content', latest.content, 'created_at', latest.created_at,
      'user_id', latest.user_id, 'sender_name', latest.sender_name,
      'reply_to_id', latest.reply_to_id, 'reply_sender_name', latest.reply_sender_name,
      'reply_to_content_id', latest.reply_to_content_id,
      'reply_to_content_kind', reply_content.kind,
      'reply_to_content_title', reply_content.title,
      'deleted_at', latest.deleted_at, 'has_image', latest.image_url is not null
    ) end,
    -- Reactions preview only while nothing newer arrived: a later message takes
    -- the line back (the sidebar clears lastReaction on the same realtime
    -- event), whichever table the reaction lives in.
    'last_reaction', case
      when reaction.message_id is null then null
      when latest.created_at is not null and reaction.created_at <= latest.created_at then null
      else jsonb_build_object(
        'message_id', reaction.message_id, 'user_id', reaction.user_id,
        'emoji', reaction.emoji, 'created_at', reaction.created_at,
        'content_kind', reaction.content_kind,
        'reactor_name', reaction.reactor_name, 'message_content', reaction.message_content,
        'has_image', reaction.message_image_url is not null
      ) end,
    'last_content', case when content_item.id is null then null else jsonb_build_object(
      'id', content_item.id, 'kind', content_item.kind, 'title', content_item.title,
      'created_at', content_item.created_at, 'user_id', content_item.user_id,
      'author_name', content_item.author_name
    ) end
  )), '[]'::jsonb)
  from memberships membership
  left join message_stats stats using (community_id)
  left join content_stats content using (community_id)
  left join latest_messages latest using (community_id)
  left join latest_reactions reaction using (community_id)
  left join latest_content content_item using (community_id)
  left join content_titles reply_content on reply_content.id = latest.reply_to_content_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_thread_list_aggregates(p_user_id uuid, p_thread_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(id uuid, like_count bigint, comment_count bigint, user_liked boolean, user_saved boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with requested as (
    select distinct requested_id as id
    from unnest(coalesce(p_thread_ids, '{}'::uuid[])) as input(requested_id)
  ),
  likes as (
    select l.thread_id as id,
      count(*) as like_count,
      bool_or(l.user_id = p_user_id) as user_liked
    from public.thread_likes as l
    where l.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by l.thread_id
  ),
  comments as (
    select c.thread_id as id, count(*) as comment_count
    from public.thread_comments as c
    where c.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by c.thread_id
  ),
  saves as (
    select s.thread_id as id, bool_or(s.user_id = p_user_id) as user_saved
    from public.thread_saves as s
    where s.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by s.thread_id
  )
  select requested.id,
    coalesce(likes.like_count, 0),
    coalesce(comments.comment_count, 0),
    coalesce(likes.user_liked, false),
    coalesce(saves.user_saved, false)
  from requested
  left join likes using (id)
  left join comments using (id)
  left join saves using (id);
$function$;

CREATE OR REPLACE FUNCTION public.get_thread_list_page(p_community_id uuid, p_user_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(item jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_user_id
  ) then
    raise insufficient_privilege using message = 'Not a member of this community.';
  end if;

  return query
  with page as (
    select t.*
    from public.community_threads t
    where t.community_id = p_community_id
      and (p_before is null or (t.created_at, t.id) < (p_before, p_cursor_id))
    order by t.created_at desc, t.id desc
    limit least(greatest(p_limit, 1), 100)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'like_count', (select count(*) from public.thread_likes l where l.thread_id = p.id),
    'comment_count', (select count(*) from public.thread_comments c where c.thread_id = p.id),
    'user_liked', exists(select 1 from public.thread_likes l where l.thread_id = p.id and l.user_id = p_user_id),
    'user_saved', exists(select 1 from public.thread_saves s where s.thread_id = p.id and s.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_unread_message_totals(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, unread integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select cm.user_id, coalesce(sum(counts.unread), 0)::integer as unread
  from public.community_members cm
  left join lateral (
    select count(*)::integer as unread
    from public.community_messages m
    where m.community_id = cm.community_id
      and m.user_id <> cm.user_id
      and m.created_at > greatest(cm.last_read_at, cm.joined_at)
  ) counts on true
  where cm.user_id = any(p_user_ids)
    and cm.archived_at is null
  group by cm.user_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_company(p_user_id uuid)
 RETURNS TABLE(company_id uuid, name text, slug text, logo_url text, is_active boolean, domain text, domain_verified boolean, membership_verified boolean, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    c.is_active,
    domain_row.domain,
    coalesce(domain_row.verified, false),
    coalesce(m.verified, false),
    m.joined_at
  from public.designer_profiles as dp
  join public.companies as c on c.id = dp.company_id
  left join public.company_members as m
    on m.company_id = c.id and m.user_id = dp.user_id
  left join lateral (
    -- The domain the company is DISPLAYED by (logo, company page link),
    -- verified first, then the directory's most confident hint. `verified`
    -- rides along so callers can still tell a proof from a known name.
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc,
             public.company_confidence_rank(d.evidence_confidence) desc,
             d.created_at asc,
             d.domain asc
    limit 1
  ) as domain_row on true
  where dp.user_id = p_user_id
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.handle_owned_communities_on_user_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  owned      record;
  next_owner uuid;
begin
  -- Every event this user hosts dies with the account (community_events
  -- cascades from users). Unlink the rooms pointing at them before anything
  -- else: the deletion's cascades go on to update these rooms (membership
  -- counter maintenance, the handover below), and a later update re-checks
  -- the FK against a link whose event row is already gone — aborting the
  -- whole account deletion with 23503. The room keeps its people and its
  -- chat; only the link goes.
  update public.communities as c
     set event_id = null
   where c.event_id in (
           select e.id from public.community_events as e where e.user_id = old.id
         );

  for owned in
    select c.id
      from public.communities as c
     where c.owner_id = old.id
     order by c.created_at asc, c.id asc
  loop
    -- Longest-standing member who is not the departing user — the same rule
    -- the in-app "owner leaves" flow (DELETE /api/communities/[id]/members)
    -- uses, so both paths hand a community over identically.
    select cm.user_id
      into next_owner
      from public.community_members as cm
      join public.users as u on u.id = cm.user_id
     where cm.community_id = owned.id
       and cm.user_id <> old.id
     order by cm.joined_at asc, cm.user_id asc
     limit 1;

    if next_owner is not null then
      -- A genuine drift row (link to an event row already gone) would abort
      -- this handover the moment the row is updated again; drop the stale
      -- link before reassigning.
      update public.communities as c
         set event_id = null
       where c.id = owned.id
         and c.event_id is not null
         and not exists (
           select 1 from public.community_events as e where e.id = c.event_id
         );

      update public.communities
         set owner_id = next_owner
       where id = owned.id;

      update public.community_members
         set role = 'owner'
       where community_id = owned.id
         and user_id = next_owner;
    else
      -- Nobody left to hand it to: drop the community rather than leave it
      -- ownerless and permanently unmanageable. lottie_settings is not
      -- covered by the FK cascade, so delete it first.
      delete from public.lottie_settings
       where scope = 'community'
         and scope_key = owned.id::text;

      delete from public.communities where id = owned.id;
    end if;
  end loop;

  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_content_restore(p_content_type text, p_content_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_content_id is not null and exists (
    select 1
      from public.content_removals as cr
     where cr.content_type = p_content_type
       and cr.content_id   = p_content_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.job_post_is_open(p_status text, p_closes_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- A posting with no deadline is open until its owner closes it; one with a
  -- deadline is open up to that instant and not a moment after.
  select p_status = 'open'
     and (p_closes_at is null or p_closes_at > pg_catalog.now());
$function$;

CREATE OR REPLACE FUNCTION public.job_post_payload(p_job_id uuid, p_viewer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', jp.id,
    'kind', jp.kind,
    'title', jp.title,
    'description', jp.description,
    'responsibilities', to_jsonb(jp.responsibilities),
    'requirements', to_jsonb(jp.requirements),
    'skills', to_jsonb(jp.skills),
    'salary', jp.salary,
    'website', jp.website,
    'work_mode', jp.work_mode,
    'employment_type', jp.employment_type,
    'city_id', jp.city_id,
    'city_name', coalesce(ci.name, 'All cities'),
    'sector_id', jp.sector_id,
    'sector_name', coalesce(se.name, 'All sectors'),
    'job_title', jp.job_title,
    'job_title_label', coalesce(jt.name, jp.job_title),
    'experience_level', jp.experience_level,
    'experience_level_label', coalesce(el.name, jp.experience_level),
    'created_at', jp.created_at,
    'status', jp.status,
    'updated_at', jp.updated_at,
    'closes_at', jp.closes_at,
    'company', jsonb_build_object(
      'id', co.id,
      'name', co.name,
      'slug', co.slug,
      'logo_url', co.logo_url,
      'domain', (
        select d.domain from public.company_domains as d
        where d.company_id = co.id
        order by d.verified desc,
                 public.company_confidence_rank(d.evidence_confidence) desc,
                 d.created_at asc,
                 d.domain asc
        limit 1
      ),
      'domain_verified', exists (
        select 1 from public.company_domains as d
        where d.company_id = co.id and d.verified
      )
    ),
    'poster', jsonb_build_object(
      'id', pu.id,
      'name', pu.name,
      'avatar_url', pd.avatar_url,
      'job_title', pd.job_title,
      'job_title_label', pjt.name,
      'experience_level', pd.experience_level,
      'experience_level_label', pel.name,
      'company_name', pc.name
    ),
    'applicant_count', (
      select count(*) from public.job_applications as ja where ja.job_id = jp.id
    ),
    'criteria_locked', exists (
      select 1 from public.job_applications as ja where ja.job_id = jp.id
    ),
    'applied', exists (
      select 1 from public.job_applications as ja
      where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
    ),
    'is_mine', jp.poster_id = p_viewer_id,
    'can_apply', (
      public.job_post_is_open(jp.status, jp.closes_at)
      and p_viewer_id is not null
      and jp.poster_id <> p_viewer_id
      and not exists (
        select 1 from public.job_applications as ja
        where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
      )
      and exists (
        select 1 from public.designer_profiles as vp
        where vp.user_id = p_viewer_id
          and (jp.city_id is null or vp.city_id = jp.city_id)
          and (jp.sector_id is null or vp.sector_id = jp.sector_id)
          and vp.job_title = jp.job_title
          and vp.experience_level = jp.experience_level
      )
    ),
    'my_application', ma.application
  )
  from public.job_posts as jp
  join public.companies as co on co.id = jp.company_id
  join public.users as pu on pu.id = jp.poster_id
  left join public.designer_profiles as pd on pd.user_id = jp.poster_id
  left join public.companies as pc on pc.id = pd.company_id
  left join public.job_titles as pjt on pjt.slug = pd.job_title
  left join public.experience_levels as pel on pel.slug = pd.experience_level
  left join public.cities as ci on ci.id = jp.city_id
  left join public.design_sectors as se on se.id = jp.sector_id
  left join public.job_titles as jt on jt.slug = jp.job_title
  left join public.experience_levels as el on el.slug = jp.experience_level
  left join lateral (
    select jsonb_build_object(
      'id', ja.id,
      'name', ja.name,
      'portfolio_url', ja.portfolio_url,
      'linkedin_url', ja.linkedin_url,
      'resume_url', ja.resume_url,
      'resume_key', ja.resume_key,
      'created_at', ja.created_at
    ) as application
    from public.job_applications as ja
    where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
  ) as ma on true
  where jp.id = p_job_id;
$function$;

CREATE OR REPLACE FUNCTION public.job_posts_guard_moderated_reopen()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.status = 'closed'
     and new.status = 'open'
     and old.moderated_at is not null
     and new.moderated_at is not null then
    raise exception 'job_moderated';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.leave_company(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  select dp.company_id into v_company_id
  from public.designer_profiles as dp
  where dp.user_id = p_user_id
  for update;

  if v_company_id is null then
    return false;
  end if;

  delete from public.company_members as m
  where m.user_id = p_user_id and m.company_id = v_company_id;

  update public.designer_profiles as dp
  set company_id = null, updated_at = now()
  where dp.user_id = p_user_id;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.library_featured_renumber(p_type text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_moved integer;
begin
  if p_type is null or p_type not in ('thread', 'showcase', 'resource') then
    raise exception using errcode = '22023', message = 'invalid_type';
  end if;

  with ordered as (
    select
      li.id,
      row_number() over (order by li.featured_rank asc, li.curated_at asc, li.id asc) as position
    from public.library_items as li
    where li.item_type = p_type
  )
  update public.library_items as li
     set featured_rank = o.position
    from ordered as o
   where li.id = o.id
     and li.featured_rank is distinct from o.position;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_dm_conversation_read(p_conversation_id uuid, p_user_id uuid, p_last_read_at timestamp with time zone)
 RETURNS TABLE(previous_marked_at timestamp with time zone, marked_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  conv public.dm_conversations%rowtype;
  effective timestamptz;
begin
  select * into conv
    from public.dm_conversations c
   where c.id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  if conv.user_a <> p_user_id and conv.user_b <> p_user_id then
    raise exception 'Not a participant of this conversation' using errcode = '42501';
  end if;

  effective := greatest(
    coalesce(
      case when conv.user_a = p_user_id then conv.user_a_last_read_at
           else conv.user_b_last_read_at end,
      '-infinity'::timestamptz
    ),
    coalesce(p_last_read_at, now())
  );

  if conv.user_a = p_user_id then
    update public.dm_conversations
       set user_a_last_read_at = effective
     where id = p_conversation_id;
    return query select conv.user_a_last_read_at, effective;
  else
    update public.dm_conversations
       set user_b_last_read_at = effective
     where id = p_conversation_id;
    return query select conv.user_b_last_read_at, effective;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.moderation_audit_log_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'moderation_audit_log is append-only';
end;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_company_domain(p_domain text, p_from_company_id uuid, p_to_company_id uuid, p_reason text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(status text, from_company_id uuid, to_company_id uuid, domain text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_domain = '' or v_domain <> p_domain then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  if p_from_company_id is null or p_to_company_id is null
     or p_from_company_id = p_to_company_id then
    raise exception using errcode = '22023', message = 'invalid_companies';
  end if;

  -- A reassignment is a decision somebody made, so it has to carry its reason.
  if v_reason is null then
    raise exception using errcode = '22023', message = 'reason_required';
  end if;

  if not exists (
    select 1 from public.companies as c where c.id = p_to_company_id and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'company_inactive';
  end if;

  update public.company_domains as d
  set verified = false, verified_at = null
  where d.company_id = p_from_company_id and d.domain = v_domain and d.verified;

  if not found then
    return query select 'not_owner'::text, p_from_company_id, p_to_company_id, v_domain;
    return;
  end if;

  insert into public.company_domains (
    company_id, domain, verified, domain_type, evidence_confidence, source
  ) values (
    p_to_company_id, v_domain, false, 'corporate_email', 'medium', 'operator_reassignment'
  )
  on conflict on constraint company_domains_company_domain_key
    do update set evidence_confidence = 'medium',
                  source = 'operator_reassignment';

  insert into public.domain_evidence (
    company_id, domain, evidence_type, source_url, source, checked, observed_at
  ) values (
    p_to_company_id, v_domain, 'operator_reassignment', null, 'operator', true, now()
  )
  on conflict do nothing;

  -- And the other side of the same decision: the company that lost the domain
  -- keeps its claim (history is not deleted) but stops competing for the
  -- steward, because an operator has said the domain is not theirs. Without
  -- this the two claims would tie and the domain would read as contested, which
  -- is the opposite of what a reassignment means.
  insert into public.domain_evidence (
    company_id, domain, evidence_type, source_url, source, checked, observed_at
  ) values (
    p_from_company_id, v_domain, 'operator_reassignment_retired', null, 'operator', true, now()
  )
  on conflict do nothing;

  return query select 'reassigned'::text, p_from_company_id, p_to_company_id, v_domain;
end;
$function$;

CREATE OR REPLACE FUNCTION public.retire_company_directory_seed(p_dry_run boolean DEFAULT false, p_allow_retained boolean DEFAULT false)
 RETURNS TABLE(companies_removed bigint, claims_removed bigint, dependents_removed bigint, companies_retained bigint, dry_run boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_companies  bigint := 0;
  v_claims     bigint := 0;
  v_dependents bigint := 0;
  v_step       bigint;
  v_retained   bigint;
begin
  -- `on commit drop` already cleans up a successful call, and a failed one
  -- rolls its CREATE back; this guard only covers a rerun in one session, and it
  -- is written so it does not print a NOTICE into an operator's log.
  if to_regclass('pg_temp._seed_retirement_plan') is not null then
    drop table _seed_retirement_plan;
  end if;

  create temporary table _seed_retirement_plan on commit drop as
    select plan.company_id
    from public.company_directory_seed_retirement_plan() as plan
    where plan.disposable;

  -- Seeded rows still present that the plan refuses to remove. A member's
  -- company that happens to share a seed slug is not a seeded row, so it is not
  -- counted here (the plan excludes it by `created_by`).
  select count(*) into v_retained
  from public.company_directory_seed_retirement_plan() as plan
  where not plan.disposable;

  if p_dry_run then
    return query select
      (select count(*) from _seed_retirement_plan)::bigint,
      (select count(*)::bigint from public.company_domains as cd
        where cd.company_id in (select company_id from _seed_retirement_plan)),
      (select count(*)::bigint from public.domain_evidence as e
        where e.company_id in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_aliases as a
        where a.company_id in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_relationships as rel
        where rel.parent_company_id in (select company_id from _seed_retirement_plan)
           or rel.child_company_id in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_domain_delegations as g
        where g.company_id in (select company_id from _seed_retirement_plan)
           or g.granted_by in (select company_id from _seed_retirement_plan))
      + (select count(*)::bigint from public.company_domain_reviews as r
        where r.company_id in (select company_id from _seed_retirement_plan)),
      v_retained,
      true;
    drop table _seed_retirement_plan;
    return;
  end if;

  -- The operator's gate. Nothing has been deleted at this point.
  if v_retained > 0 and not p_allow_retained then
    raise exception using
      errcode = 'P0001',
      message = 'seed_reset_retained_rows_present',
      hint = format(
        '%s seeded companies are referenced by application data; review public.company_directory_seed_retained, then re-run with p_allow_retained => true to remove only the disposable rows',
        v_retained
      );
  end if;

  -- Belt and braces, in the one direction that matters: refuse the whole
  -- transition if a row the plan called disposable is referenced after all. The
  -- guards above already exclude these, so this can only fire if the plan and
  -- the deletes ever disagree — and then the right answer is to stop, not to
  -- delete a member's company.
  if exists (
    select 1 from public.company_members as m
     where m.company_id in (select company_id from _seed_retirement_plan)
    union all
    select 1 from public.company_email_verifications as v
     where v.company_id in (select company_id from _seed_retirement_plan)
        or v.domain_owner_company_id in (select company_id from _seed_retirement_plan)
    union all
    select 1 from public.designer_profiles as p
     where p.company_id in (select company_id from _seed_retirement_plan)
    union all
    select 1 from public.company_domains as cd
     where cd.company_id in (select company_id from _seed_retirement_plan) and cd.verified
  ) then
    raise exception using errcode = 'P0001', message = 'seed_retirement_would_touch_member_data';
  end if;

  delete from public.company_domains as cd
   where cd.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_claims := v_claims + v_step;

  delete from public.domain_evidence as e
   where e.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_aliases as a
   where a.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_relationships as rel
   where rel.parent_company_id in (select company_id from _seed_retirement_plan)
      or rel.child_company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_domain_delegations as g
   where g.company_id in (select company_id from _seed_retirement_plan)
      or g.granted_by in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  delete from public.company_domain_reviews as r
   where r.company_id in (select company_id from _seed_retirement_plan);
  get diagnostics v_step = row_count;
  v_dependents := v_dependents + v_step;

  -- Last, and with the identity guard repeated: these are the rows this whole
  -- operation is about, so the predicate is stated where it deletes.
  delete from public.companies as c
   where c.id in (select company_id from _seed_retirement_plan)
     and c.created_by is null;
  get diagnostics v_step = row_count;
  v_companies := v_companies + v_step;

  drop table _seed_retirement_plan;

  return query select v_companies, v_claims, v_dependents, v_retained, false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_account_verification(p_request_id uuid, p_action text, p_reason text, p_reviewed_by text)
 RETURNS TABLE(user_id uuid, verification_status text, reapply_at timestamp with time zone, user_name text, user_email text, rejection_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_user_name text;
  v_user_email text;
  v_reason text;
  v_reapply_at timestamptz;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
  end if;

  select r.user_id, u.name, u.email
    into v_user_id, v_user_name, v_user_email
    from public.account_verification_requests r
    join public.users u on u.id = r.user_id
   where r.id = p_request_id
     and r.status = 'pending'
   for update of r;

  if v_user_id is null then
    raise exception 'request_not_pending';
  end if;

  if p_action = 'approve' then
    update public.account_verification_requests
       set status = 'approved',
           rejection_reason = null,
           reviewed_by = p_reviewed_by,
           reviewed_at = now(),
           updated_at = now()
     where id = p_request_id;

    update public.users
       set verification_status = 'approved',
           verification_rejection_reason = null,
           verification_reapply_at = null,
           verification_reviewed_at = now(),
           verification_notified_at = null
     where id = v_user_id;
  else
    v_reason := nullif(trim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'reason_required';
    end if;

    v_reapply_at := now() + interval '1 month';

    update public.account_verification_requests
       set status = 'rejected',
           rejection_reason = v_reason,
           reviewed_by = p_reviewed_by,
           reviewed_at = now(),
           updated_at = now()
     where id = p_request_id;

    update public.users
       set verification_status = 'rejected',
           verification_rejection_reason = v_reason,
           verification_reapply_at = v_reapply_at,
           verification_reviewed_at = now(),
           verification_notified_at = null
     where id = v_user_id;
  end if;

  return query
    select u.id, u.verification_status, u.verification_reapply_at,
           v_user_name, v_user_email, u.verification_rejection_reason
      from public.users u
     where u.id = v_user_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_company_domain(p_domain text, p_company_id uuid, p_reviewer_id uuid, p_decision text, p_reason text, p_confidence text DEFAULT 'high'::text, p_evidence_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(status text, domain text, company_id uuid, evidence_confidence text, verified boolean, review_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_domain    text := lower(btrim(coalesce(p_domain, '')));
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_decision  text := lower(btrim(coalesce(p_decision, '')));
  v_confidence text := lower(btrim(coalesce(p_confidence, 'high')));
  v_before    text;
  v_after     text;
  v_verified  boolean := false;
  v_owner_id  uuid;
  v_review_id uuid;
begin
  -- ── Who and why, before anything else ────────────────────
  if p_reviewer_id is null then
    raise exception using errcode = '22023', message = 'reviewer_required';
  end if;

  if not exists (select 1 from public.users as u where u.id = p_reviewer_id) then
    raise exception using errcode = 'P0001', message = 'unknown_reviewer';
  end if;

  if v_reason is null then
    raise exception using errcode = '22023', message = 'reason_required';
  end if;

  if v_decision not in ('promote', 'reject', 'needs_more_evidence') then
    raise exception using errcode = '22023', message = 'invalid_decision';
  end if;

  if v_confidence not in ('medium', 'high') then
    raise exception using errcode = '22023', message = 'invalid_confidence';
  end if;

  if v_domain = '' or v_domain <> p_domain then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  -- ── The claim under review ──────────────────────────────
  select d.evidence_confidence, d.verified
    into v_before, v_verified
  from public.company_domains as d
  where d.company_id = p_company_id and d.domain = v_domain;

  if v_before is null then
    return query select 'no_claim'::text, v_domain, p_company_id, null::text, false, null::uuid;
    return;
  end if;

  select d.company_id into v_owner_id
  from public.company_domains as d
  where d.domain = v_domain and d.verified and d.company_id <> p_company_id
  limit 1;

  if v_owner_id is not null then
    -- The domain is somebody's proof. A promotion here would only produce a
    -- claim that can never be verified, and the honest route is the operator
    -- reassignment (`reassign_company_domain`), which is a different decision
    -- with a different audit trail.
    return query select 'domain_verified_elsewhere'::text, v_domain, p_company_id,
      v_before, false, null::uuid;
    return;
  end if;

  if v_decision = 'promote' then
    -- A verified claim is already as far as a proof can take it. Rewriting its
    -- confidence (or adding an `operator_review` observation to it) would edit
    -- the state a member's proof produced, which is the one thing a reviewer
    -- must not be able to do. Nothing to promote, nothing to change.
    if v_verified then
      return query select 'already_verified'::text, v_domain, p_company_id, v_before, true, null::uuid;
      return;
    end if;

    if not public.company_domain_evidence_supports_promotion(p_company_id, v_domain) then
      return query select 'needs_evidence'::text, v_domain, p_company_id, v_before, false, null::uuid;
      return;
    end if;

    if v_before = v_confidence and v_before = 'high' then
      return query select 'already_promoted'::text, v_domain, p_company_id, v_before, false, null::uuid;
      return;
    end if;

    v_after := v_confidence;
  else
    -- Rejection and `needs_more_evidence` change no claim: the evidence and the
    -- confidence stay exactly where they were, which is what makes the history
    -- readable afterwards.
    v_after := null;
  end if;

  insert into public.company_domain_reviews (
    domain, company_id, evidence_id, reviewer_id, decision, reason,
    before_confidence, after_confidence
  ) values (
    v_domain, p_company_id, p_evidence_id, p_reviewer_id, v_decision, v_reason,
    v_before, v_after
  )
  on conflict do nothing
  returning id into v_review_id;

  if v_after is not null then
    -- The promotion itself. `verified` is untouched and `verified_at` stays
    -- null: the claim is eligible, not verified.
    update public.company_domains as d
    set evidence_confidence = v_after,
        last_checked_at = now()
    where d.company_id = p_company_id and d.domain = v_domain;

    -- The review IS evidence, so it is recorded like any other observation:
    -- checked, attributable, and of a kind that speaks to corporate mail. If
    -- the promotion is ever revisited, this row is why it happened.
    insert into public.domain_evidence (
      company_id, domain, evidence_type, source_url, source, checked, observed_at
    ) values (
      p_company_id, v_domain, 'operator_review', null, 'operator_review', true, now()
    )
    on conflict do nothing;
  end if;

  return query select
    case when v_decision = 'promote' then 'promoted' else v_decision end,
    v_domain,
    p_company_id,
    coalesce(v_after, v_before),
    false,
    v_review_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_all_admin_sessions(p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where role = 'admin'
     and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_all_user_sessions(p_user_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_version integer;
begin
  update public.users
     set session_version = session_version + 1,
         updated_at = now()
   where id = p_user_id
  returning session_version into v_version;

  if v_version is null then
    return null;
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and revoked_at is null;

  return v_version;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_auth_session(p_session_id uuid, p_reason text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where id = p_session_id;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_other_user_sessions(p_user_id uuid, p_keep_session_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and (p_keep_session_id is null or id <> p_keep_session_id)
     and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.search_companies(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, name text, slug text, logo_url text, domain text, verified boolean, member_count bigint, evidence_confidence text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Escaped for LIKE, and a lowercased copy for the domain/slug arms (the
  -- stored forms are already lowercase, and `ilike` cannot use a btree).
  v_term  text := public.company_search_term(p_query);
  v_lower text := lower(public.company_search_term(p_query));
  v_max   integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  -- An empty query browses the directory instead of returning nothing, and the
  -- curated design block leads that browse.
  --
  -- Two arms, each bounded by `v_max` and each an index walk: the featured rows
  -- in curated rank order (companies_featured_rank_idx), then everything else by
  -- name (companies_active_name_idx), folded back together in arm order. The
  -- one-arm form — `order by c.featured_rank nulls last, c.name` — has to sort
  -- every active company before the LIMIT can discard any of them, which is the
  -- cost this shape exists to avoid at 500,000 rows.
  if v_term = '' then
    return query
    with browse as (
      (select c.id as company_id, 0 as arm, c.featured_rank as arm_rank
       from public.companies as c
       where c.is_active and c.featured_rank is not null
       order by c.featured_rank asc
       limit v_max)
      union all
      (select c.id, 1, null::integer
       from public.companies as c
       where c.is_active and c.featured_rank is null
       order by c.name asc
       limit v_max)
    )
    select
      c.id, c.name, c.slug, c.logo_url,
      dom.domain,
      coalesce(dom.verified, false),
      (select count(*) from public.company_members as m
        where m.company_id = c.id and m.verified),
      dom.evidence_confidence
    from browse as b
    join public.companies as c on c.id = b.company_id
    left join lateral (
      select d.domain, d.verified, d.evidence_confidence
      from public.company_domains as d
      where d.company_id = c.id
      order by d.verified desc,
               public.company_confidence_rank(d.evidence_confidence) desc,
               d.created_at asc,
               d.domain asc
      limit 1
    ) as dom on true
    order by b.arm asc, b.arm_rank asc nulls last, c.name asc
    limit v_max;
    return;
  end if;

  if length(v_lower) < 3 then
    -- A prefix search: one or two characters are a start-of-name lookup, not a
    -- substring one, so each arm is anchored and every arm is index-backed.
    return query
    with matched as (
      -- Ordered by lower(name) because that is the index
      -- (companies_name_lower_prefix_idx): the range scan and the ordering are
      -- the same walk, so the arm stops as soon as it has 25.
      (select c.id as company_id, 0 as arm, true as name_prefix
       from public.companies as c
       where c.is_active and lower(c.name) like v_lower || '%'
       order by lower(c.name) asc
       limit v_max)
      union all
      (select c.id, 1, false
       from public.companies as c
       where c.is_active and c.slug like v_lower || '%'
       order by c.name asc
       limit v_max)
      union all
      (select d.company_id, 3, false
       from public.company_domains as d
       join public.companies as dc on dc.id = d.company_id and dc.is_active
       where d.domain like v_lower || '%'
       order by d.domain asc
       limit v_max)
    ), scored as (
      select company_id, min(arm) as arm, bool_or(name_prefix) as name_prefix
      from matched
      group by company_id
    )
    select
      c.id, c.name, c.slug, c.logo_url,
      dom.domain,
      coalesce(dom.verified, false),
      (select count(*) from public.company_members as m
        where m.company_id = c.id and m.verified),
      dom.evidence_confidence
    from scored as s
    join public.companies as c on c.id = s.company_id
    left join lateral (
      select d.domain, d.verified, d.evidence_confidence
      from public.company_domains as d
      where d.company_id = c.id
      order by d.verified desc,
               public.company_confidence_rank(d.evidence_confidence) desc,
               d.created_at asc,
               d.domain asc
      limit 1
    ) as dom on true
    order by s.name_prefix desc, coalesce(dom.verified, false) desc, c.name asc
    limit v_max;
    return;
  end if;

  -- Three characters or more: substring arms, each on its own index.
  --
  -- Every arm is BOUNDED by `v_max` and ordered by name inside itself. Two
  -- reasons, and both are about a big directory:
  --
  --   * an arm of a UNION ALL that has no limit of its own has to produce every
  --     match before the outer LIMIT can discard them, so a term matching 5% of
  --     500,000 rows makes the whole search cost that 5% — measured at 64 ms for
  --     a 5%-common name and 153 ms for a broad one at 100,000 rows;
  --   * the arms are ordered by WHERE THE MATCH IS (`strpos`), then by name,
  --     which keeps the 25 that survive deterministic without asking the planner
  --     for an ordering the trigram index cannot provide. Ordering by name
  --     instead makes the plan walk the name index and throw rows away until it
  --     finds 25 matches: measured at 500,000 rows that is 169–185 ms, against
  --     82 ms for the unordered bitmap, because the matches it needs are late in
  --     alphabetical order. `strpos` ranks a name starting with the term above
  --     one that contains it, which is also the better answer.
  --
  -- What this does not fix, deliberately: a term like 'ent' still matches a large
  -- share of the directory, and any search that must look inside every name pays
  -- for the matches it finds. The picker's interactive path is protected by the
  -- 2-character rule above (prefix only) and by the client's debounce; the honest
  -- numbers per tier are in docs/company-directory-architecture.md §11.
  return query
  with matched as (
    (select c.id as company_id, 0 as arm, (c.name ilike v_term || '%') as name_prefix
     from public.companies as c
     where c.is_active and c.name ilike '%' || v_term || '%'
     order by strpos(lower(c.name), v_lower), c.name asc
     limit v_max)
    union all
    (select c.id, 1, false
     from public.companies as c
     where c.is_active and c.slug ilike '%' || v_lower || '%'
     order by strpos(lower(c.slug), v_lower), c.slug asc
     limit v_max)
    union all
    (select a.company_id, 2, false
     from public.company_aliases as a
     join public.companies as ac on ac.id = a.company_id and ac.is_active
     where a.alias ilike '%' || v_term || '%'
     order by strpos(lower(a.alias), v_lower), a.alias asc
     limit v_max)
    union all
    -- Verified domains only: typing a domain asks "who owns this?", and a hint
    -- owns nothing. A hint is still reachable by the company's name.
    (select d.company_id, 3, false
     from public.company_domains as d
     join public.companies as dc on dc.id = d.company_id and dc.is_active
     where d.verified and d.domain like v_lower || '%'
     order by d.domain asc
     limit v_max)
  ), scored as (
    select company_id, min(arm) as arm, bool_or(name_prefix) as name_prefix
    from matched
    group by company_id
  )
  select
    c.id, c.name, c.slug, c.logo_url,
    dom.domain,
    coalesce(dom.verified, false),
    (select count(*) from public.company_members as m
      where m.company_id = c.id and m.verified),
    dom.evidence_confidence
  from scored as s
  join public.companies as c on c.id = s.company_id
  left join lateral (
    select d.domain, d.verified, d.evidence_confidence
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc,
             public.company_confidence_rank(d.evidence_confidence) desc,
             d.created_at asc,
             d.domain asc
    limit 1
  ) as dom on true
  order by s.name_prefix desc, coalesce(dom.verified, false) desc, c.name asc
  limit v_max;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_experience_levels_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

CREATE OR REPLACE FUNCTION public.set_job_application_status(p_actor_id uuid, p_application_id uuid, p_status text)
 RETURNS TABLE(application_id uuid, application_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status text := btrim(coalesce(p_status, ''));
begin
  if v_status not in ('new', 'shortlisted', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_status';
  end if;

  -- Owner-scoped through the application's own job, in one statement,
  -- so the check and the change are one write: nobody can win a race
  -- between them.
  return query
  with updated as (
    update public.job_applications as ja
       set status = v_status
     where ja.id = p_application_id
       and exists (
         select 1 from public.job_posts as jp
         where jp.id = ja.job_id and jp.poster_id = p_actor_id
       )
    returning ja.id, ja.status
  )
  select updated.id, updated.status from updated;

  -- Say which refusal it was: the application is gone, or its posting
  -- is not this actor's.
  if not found then
    if exists (
      select 1 from public.job_applications as ja where ja.id = p_application_id
    ) then
      raise exception using errcode = 'P0001', message = 'not_your_job';
    end if;
    raise exception using errcode = 'P0002', message = 'application_not_found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_job_post_status(p_actor_id uuid, p_job_id uuid, p_status text)
 RETURNS TABLE(job_id uuid, job_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status text := btrim(coalesce(p_status, ''));
begin
  if v_status not in ('open', 'closed') then
    raise exception using errcode = '22023', message = 'invalid_status';
  end if;

  -- Owner-scoped in the write itself, so the check and the change are
  -- one statement: nobody can win a race between them. Closing does
  -- not touch updated_at — the content did not change.
  --
  -- Reopening cannot mean "open with a deadline in the past": a deadline
  -- that has already passed is cleared, so Reopen genuinely reopens rather
  -- than leaving an Expired posting the member cannot explain.
  return query
  with updated as (
    update public.job_posts as jp
       set status = v_status,
           closes_at = case
             when v_status = 'open'
              and jp.closes_at is not null
              and jp.closes_at <= pg_catalog.now()
               then null
             else jp.closes_at
           end
     where jp.id = p_job_id and jp.poster_id = p_actor_id
    returning jp.id, jp.status
  )
  select updated.id, updated.status from updated;

  -- Say which refusal it was: the posting is gone, or it is not theirs.
  if not found then
    if exists (select 1 from public.job_posts as jp where jp.id = p_job_id) then
      raise exception using errcode = 'P0001', message = 'not_your_job';
    end if;
    raise exception using errcode = 'P0002', message = 'job_not_found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_job_titles_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_blocked(p_user_id uuid, p_blocked boolean, p_reason text)
 RETURNS TABLE(id uuid, is_blocked boolean, session_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.users as u
     set is_blocked = p_blocked,
         session_version = u.session_version + 1,
         updated_at = now()
   where u.id = p_user_id
  returning u.id, u.is_blocked, u.session_version
       into id, is_blocked, session_version;

  if not found then
    raise exception 'account_unavailable' using errcode = 'P0001';
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and revoked_at is null;

  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_suspended(p_user_id uuid, p_until timestamp with time zone, p_reason text)
 RETURNS TABLE(id uuid, suspended_until timestamp with time zone, session_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.users as u
     set suspended_until = p_until,
         session_version = u.session_version + 1,
         updated_at = now()
   where u.id = p_user_id
  returning u.id, u.suspended_until, u.session_version
       into id, suspended_until, session_version;

  if not found then
    raise exception 'account_unavailable' using errcode = 'P0001';
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and revoked_at is null;

  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_company_verification(p_user_id uuid, p_domain text, p_work_email text, p_code_hash text, p_company_id uuid DEFAULT NULL::uuid, p_company_name text DEFAULT NULL::text, p_ttl_minutes integer DEFAULT 30)
 RETURNS TABLE(verification_id uuid, company_id uuid, company_name text, domain text, work_email text, expires_at timestamp with time zone, claim_confidence text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_domain          text := lower(btrim(coalesce(p_domain, '')));
  v_email           text := lower(btrim(coalesce(p_work_email, '')));
  v_company_id      uuid := p_company_id;
  v_company_name    text;
  v_own_claim       boolean := false;
  v_owner_id        uuid;
  v_owner_name      text;
  v_owner_verified  boolean := false;
  v_steward_id      uuid;
  v_steward_name    text;
  v_steward_verified boolean := false;
  v_contested       boolean := false;
  v_claim_count     integer := 0;
  v_claim_confidence text;
  v_strong_id       uuid;
  v_strong_name     text;
  v_via_delegation  boolean := false;
  v_name_match_id   uuid;
  v_name_match_name text;
  v_verification_id uuid;
  v_expires_at      timestamptz := now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 5));
begin
  if p_user_id is null or not exists (select 1 from public.users as u where u.id = p_user_id) then
    raise exception using errcode = '23503', message = 'unknown_user';
  end if;

  -- The route always passes an already-normalised domain, so a mismatch means
  -- the value was not normalised (a bypass) and is rejected outright.
  if v_domain = ''
     or v_domain <> p_domain
     or v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  if v_email = '' or v_email !~ '^[^@[:space:]]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception using errcode = '22023', message = 'invalid_work_email';
  end if;

  if split_part(v_email, '@', 2) <> v_domain then
    raise exception using errcode = '22023', message = 'email_domain_mismatch';
  end if;

  -- The resolved state of the domain, read once.
  select s.company_id, s.name, s.verified, s.claim_count, s.contested
    into v_steward_id, v_steward_name, v_steward_verified, v_claim_count, v_contested
  from public.company_domain_steward(v_domain) as s;

  if v_company_id is not null then
    -- ── Joining an existing company ──────────────────────────
    select c.name into v_company_name
    from public.companies as c
    where c.id = v_company_id and c.is_active;

    if v_company_name is null then
      raise exception using errcode = 'P0001', message = 'company_inactive';
    end if;

    select exists (
      select 1 from public.company_domains as d
      where d.company_id = v_company_id and d.domain = v_domain
    ) into v_own_claim;

    if v_own_claim then
      -- A, B, D and E: the member picked this company and it claims the domain.
      -- The challenge always opens — the member may legitimately be checking
      -- their own mailbox — but it carries the confidence, because a code
      -- against a `low`/`unknown` claim can only establish domain control.
      select d.evidence_confidence into v_claim_confidence
      from public.company_domains as d
      where d.company_id = v_company_id and d.domain = v_domain
      order by public.company_confidence_rank(d.evidence_confidence) desc
      limit 1;

      v_owner_id := v_company_id;
    elsif public.company_domain_delegation_allowed(v_company_id, v_domain) then
      -- F: the domain belongs to another entity and a reviewed delegation says
      -- this one's staff do use it. This is checked BEFORE the proof-owner
      -- refusal below, because a delegation exists precisely for the case
      -- where the steward's domain is already proved — refusing first would
      -- make a delegation useless for the thing it is for. The steward stays
      -- who it was: nobody's claim moved.
      v_via_delegation := true;
      v_owner_id := v_steward_id;
    elsif v_steward_verified and v_steward_id is distinct from v_company_id then
      -- C: somebody else proved it, and no delegation covers this member.
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_steward_id,
          'company_name', v_steward_name,
          'reason', 'verified'
        )::text;
    else
      -- No claim of its own and no delegation: the domain is not one this
      -- company has any basis to accept, whether or not somebody else claims it.
      raise exception using errcode = 'P0001', message = 'domain_not_verified_for_company',
        detail = jsonb_build_object(
          'reason', 'not_a_company_domain',
          'company_id', v_steward_id,
          'company_name', v_steward_name
        )::text;
    end if;

    if exists (
      select 1 from public.company_members as m
      where m.company_id = v_company_id and m.user_id = p_user_id and m.verified
    ) then
      raise exception using errcode = 'P0001', message = 'already_member';
    end if;
  else
    -- ── Creating a company ───────────────────────────────────
    v_company_name := nullif(btrim(coalesce(p_company_name, '')), '');
    if v_company_name is null then
      raise exception using errcode = '22023', message = 'company_name_required';
    end if;

    if v_steward_verified then
      -- The domain is proved. A new company would be a duplicate from the
      -- typed name; join the one that proved it.
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_steward_id,
          'company_name', v_steward_name,
          'reason', 'verified'
        )::text;
    end if;

    -- H. A claim blocks a new company only when it is medium-or-better
    -- evidence: that is a reviewed source saying "this is a real mail domain
    -- for this company", and minting a second company for it would split the
    -- domain. A low/unknown claim does NOT block — it is exactly the case the
    -- directory seed creates thousands of, and a bad seed must never be able to
    -- reserve a domain that a real company can prove.
    select d.company_id, c.name into v_strong_id, v_strong_name
    from public.company_domains as d
    join public.companies as c on c.id = d.company_id and c.is_active
    where d.domain = v_domain
      and not d.verified
      and d.evidence_confidence in ('high', 'medium')
    order by public.company_confidence_rank(d.evidence_confidence) desc, d.created_at asc
    limit 1;

    if v_strong_id is not null then
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_strong_id,
          'company_name', v_strong_name,
          'reason', 'reserved'
        )::text;
    end if;

    -- Anti-impersonation: an existing company name cannot be re-created under
    -- a domain that company does not own. Without this, "Google" + a work
    -- email on some unrelated domain would put the word Google on a profile as
    -- a brand-new company. This also covers a weak claim whose company carries
    -- the very name being typed: joining it is the only way forward.
    select c.id, c.name into v_name_match_id, v_name_match_name
    from public.companies as c
    where c.is_active and lower(btrim(c.name)) = lower(v_company_name)
    limit 1;

    if v_name_match_id is not null then
      raise exception using errcode = 'P0001', message = 'company_name_taken',
        detail = jsonb_build_object(
          'company_id', v_name_match_id,
          'company_name', v_name_match_name
        )::text;
    end if;
  end if;

  -- One live challenge per member: starting again retires the previous code so
  -- an old email can never be replayed after a resend.
  update public.company_email_verifications as v
  set consumed_at = now()
  where v.user_id = p_user_id and v.consumed_at is null;

  insert into public.company_email_verifications (
    user_id, company_id, company_name, domain, work_email, code_hash, expires_at,
    domain_owner_company_id, via_delegation, contested
  ) values (
    p_user_id, v_company_id, v_company_name, v_domain, v_email, p_code_hash, v_expires_at,
    v_owner_id, v_via_delegation, coalesce(v_contested, false)
  )
  returning id into v_verification_id;

  return query
  select v_verification_id, v_company_id, v_company_name, v_domain, v_email, v_expires_at,
         v_claim_confidence;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_community_member_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    update public.communities
       set member_count = member_count + 1
     where id = new.community_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.communities
       set member_count = member_count - 1
     where id = old.community_id;
    return old;
  end if;

  -- UPDATE: a membership moved from one community to another. Nothing in the
  -- application writes community_id, but the trigger below exists so that a
  -- future one cannot silently leave both counters wrong. The pair is applied
  -- old-then-new so two moves over the same two communities take their rows in
  -- the same order.
  update public.communities
     set member_count = member_count - 1
   where id = old.community_id;

  update public.communities
     set member_count = member_count + 1
   where id = new.community_id;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_job_post(p_actor_id uuid, p_job_id uuid, p_title text, p_city_id uuid, p_sector_id uuid, p_job_title text, p_experience_level text, p_work_mode text, p_employment_type text, p_salary text, p_description text, p_responsibilities text[] DEFAULT NULL::text[], p_requirements text[] DEFAULT NULL::text[], p_skills text[] DEFAULT NULL::text[], p_website text DEFAULT NULL::text, p_closes_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(job_id uuid, edited_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job         public.job_posts%rowtype;
  v_title       text := btrim(coalesce(p_title, ''));
  v_job_title   text := btrim(coalesce(p_job_title, ''));
  v_experience  text := btrim(coalesce(p_experience_level, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_salary      text := nullif(btrim(coalesce(p_salary, '')), '');
  v_website     text := nullif(btrim(coalesce(p_website, '')), '');
  v_locked      boolean;
  v_responsibilities text[];
  v_requirements     text[];
  v_skills           text[];
begin
  select * into v_job from public.job_posts as jp where jp.id = p_job_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'job_not_found';
  end if;

  if v_job.poster_id is distinct from p_actor_id then
    raise exception using errcode = 'P0001', message = 'not_your_job';
  end if;

  -- The gate that makes this edit safe: the four criteria
  -- apply_to_job compares against a member's profile cannot move once
  -- anybody has applied. Checked before the field validation so the
  -- reason a save was refused is never buried under a shape error.
  v_locked := exists (
    select 1 from public.job_applications as ja where ja.job_id = p_job_id
  );

  if v_locked and (
       v_job.city_id          is distinct from p_city_id
       or v_job.sector_id     is distinct from p_sector_id
       or v_job.job_title     is distinct from v_job_title
       or v_job.experience_level is distinct from v_experience
     ) then
    raise exception using errcode = 'P0001', message = 'criteria_locked';
  end if;

  -- Everything below mirrors create_job_post: an edit can never store
  -- a shape the create path would have refused.
  if char_length(v_title) < 2 or char_length(v_title) > 140 then
    raise exception using errcode = '22023', message = 'invalid_title';
  end if;

  if v_description = '' then
    raise exception using errcode = '22023', message = 'missing_description';
  end if;

  if p_work_mode not in ('remote', 'hybrid', 'onsite') then
    raise exception using errcode = '22023', message = 'invalid_work_mode';
  end if;

  if p_employment_type not in ('full_time', 'part_time', 'contract', 'internship') then
    raise exception using errcode = '22023', message = 'invalid_employment_type';
  end if;

  if p_city_id is not null and not exists (
    select 1 from public.cities as ci
    where ci.id = p_city_id and ci.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_city';
  end if;

  if p_sector_id is not null and not exists (
    select 1 from public.design_sectors as se
    where se.id = p_sector_id and se.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_sector';
  end if;

  if not exists (
    select 1 from public.job_titles as jt
    where jt.slug = v_job_title and jt.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_job_title';
  end if;

  if not exists (
    select 1 from public.experience_levels as el
    where el.slug = v_experience and el.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_experience_level';
  end if;

  if v_website is not null and v_website !~* '^https?://' then
    raise exception using errcode = '22023', message = 'invalid_website';
  end if;

  -- Same normalisation as the create write — trimmed, blank rows dropped,
  -- capped at 20 items — but only for a list the caller actually sent. A NULL
  -- (or absent) list carries the stored one through untouched, which also
  -- keeps it out of the change test below: an edit that never mentioned the
  -- lists must not read as "this posting changed".
  if p_responsibilities is null then
    v_responsibilities := v_job.responsibilities;
  else
    v_responsibilities := (
      select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
      from unnest(p_responsibilities) with ordinality as t (item, ord)
      where btrim(item) <> ''
    );
  end if;

  if p_requirements is null then
    v_requirements := v_job.requirements;
  else
    v_requirements := (
      select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
      from unnest(p_requirements) with ordinality as t (item, ord)
      where btrim(item) <> ''
    );
  end if;

  if p_skills is null then
    v_skills := v_job.skills;
  else
    v_skills := (
      select coalesce((array_agg(left(btrim(item), 60) order by ord))[1:20], '{}')
      from unnest(p_skills) with ordinality as t (item, ord)
      where btrim(item) <> ''
    );
  end if;

  -- The row comparison is the "did anything change" test: a save that
  -- changes nothing does not move updated_at, so the posting never
  -- advertises an edit that did not happen.
  return query
  with updated as (
    update public.job_posts as jp
       set title            = v_title,
           city_id          = p_city_id,
           sector_id        = p_sector_id,
           job_title        = v_job_title,
           experience_level = v_experience,
           work_mode        = p_work_mode,
           employment_type  = p_employment_type,
           salary           = left(v_salary, 80),
           description      = v_description,
           closes_at        = p_closes_at,
           responsibilities = v_responsibilities,
           requirements     = v_requirements,
           skills           = v_skills,
           website          = v_website,
           updated_at       = now()
     where jp.id = p_job_id
       and (
         jp.title, jp.city_id, jp.sector_id, jp.job_title, jp.experience_level,
         jp.work_mode, jp.employment_type, jp.salary, jp.description, jp.closes_at,
         jp.responsibilities, jp.requirements, jp.skills, jp.website
       ) is distinct from (
         v_title, p_city_id, p_sector_id, v_job_title, v_experience,
         p_work_mode, p_employment_type, left(v_salary, 80), v_description, p_closes_at,
         v_responsibilities, v_requirements, v_skills, v_website
       )
    returning jp.id, jp.updated_at
  )
  select updated.id, updated.updated_at from updated;

  if not found then
    return query
    select jp.id, jp.updated_at from public.job_posts as jp where jp.id = p_job_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_profile_identity(p_user_id uuid, p_name text DEFAULT NULL::text, p_city_id uuid DEFAULT NULL::uuid, p_sector_id uuid DEFAULT NULL::uuid, p_experience_level text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_city_id uuid;
  v_sector_id uuid;
  v_experience_level text;
  v_job_title text;
  v_new_name text;
  v_experience_changed boolean := false;
  v_job_title_changed boolean := false;
  v_city_changed boolean := false;
  v_sector_changed boolean := false;
  v_changed text[] := array[]::text[];
  v_locked jsonb;
  v_left jsonb := '[]'::jsonb;
  v_joined jsonb := '[]'::jsonb;
  v_move record;
  v_group record;
  v_community_id uuid;
  v_community_name text;
  v_community_image text;
  v_upserted integer;
  v_member_count integer;
  v_join_cap integer;
begin
  -- ── Lock the member's rows so two edits cannot interleave ──
  select u.name
    into v_name
    from public.users as u
   where u.id = p_user_id
   for update;

  select dp.city_id, dp.sector_id, dp.experience_level::text, dp.job_title
    into v_city_id, v_sector_id, v_experience_level, v_job_title
    from public.designer_profiles as dp
   where dp.user_id = p_user_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  -- ── What actually changed (a null parameter leaves that slot as is) ──
  if p_name is not null then
    v_new_name := btrim(p_name);
    if v_new_name = '' then
      raise exception using errcode = '22023', message = 'invalid_name';
    end if;
    if v_new_name is distinct from v_name then
      v_changed := array_append(v_changed, 'name');
    else
      v_new_name := null;
    end if;
  end if;

  if p_city_id is not null and p_city_id is distinct from v_city_id then
    v_city_changed := true;
    v_changed := array_append(v_changed, 'city');
  end if;

  if p_sector_id is not null and p_sector_id is distinct from v_sector_id then
    v_sector_changed := true;
    v_changed := array_append(v_changed, 'sector');
  end if;

  -- Experience level and job title are separate slots — separate fields in
  -- signup and in the modal — so each carries its own three-month cooldown.
  v_experience_changed :=
    p_experience_level is not null and p_experience_level is distinct from v_experience_level;
  v_job_title_changed :=
    p_job_title is not null and p_job_title is distinct from v_job_title;

  if v_experience_changed then
    v_changed := array_append(v_changed, 'experience_level');
  end if;

  if v_job_title_changed then
    v_changed := array_append(v_changed, 'job_title');
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object(
      'changed_fields', '[]'::jsonb,
      'left_communities', v_left,
      'joined_communities', v_joined
    );
  end if;

  -- ── Cooldown gate: lock the records, then refuse slots changed < 3 months ago ──
  perform 1
    from public.profile_field_changes as pfc
   where pfc.user_id = p_user_id
     and pfc.field = any (v_changed)
   for update;

  select jsonb_object_agg(locked.field, to_jsonb(locked.available_at))
    into v_locked
    from (
      select pfc.field,
             pfc.changed_at + interval '3 months' as available_at
        from public.profile_field_changes as pfc
       where pfc.user_id = p_user_id
         and pfc.field = any (v_changed)
         and pfc.changed_at > now() - interval '3 months'
    ) as locked;

  if v_locked is not null then
    raise exception using
      errcode = 'P0001',
      message = 'profile_field_cooldown',
      detail  = v_locked::text;
  end if;

  -- ── Every new value must exist in master data and be active ──
  if v_city_changed and not exists (
    select 1 from public.cities as c where c.id = p_city_id and c.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if v_sector_changed and not exists (
    select 1 from public.design_sectors as s where s.id = p_sector_id and s.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if v_experience_changed and not exists (
    select 1 from public.experience_levels as e
     where e.slug = p_experience_level and e.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if v_job_title_changed and not exists (
    select 1 from public.job_titles as j
     where j.slug = p_job_title and j.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  -- ── Apply the updates ──
  if 'name' = any (v_changed) then
    update public.users set name = v_new_name where id = p_user_id;
  end if;

  update public.designer_profiles as dp
     set city_id          = case when v_city_changed then p_city_id else dp.city_id end,
         sector_id        = case when v_sector_changed then p_sector_id else dp.sector_id end,
         experience_level = case when v_experience_changed then p_experience_level else dp.experience_level end,
         job_title        = case when v_job_title_changed then p_job_title else dp.job_title end
   where dp.user_id = p_user_id;

  -- ── Record the change timestamps ──
  -- The ON CONFLICT ... WHERE re-runs the cooldown test inside the write, so
  -- two concurrent edits still cannot both consume a fresh slot: the loser
  -- inserts/updates no row and the count check below raises.
  with upserted as (
    insert into public.profile_field_changes as pfc (user_id, field, changed_at)
    select p_user_id, slot.field, now()
      from unnest(v_changed) as slot(field)
    on conflict (user_id, field) do update
      set changed_at = excluded.changed_at
      where pfc.changed_at <= now() - interval '3 months'
    returning pfc.field
  )
  select count(*) into v_upserted from upserted;

  if v_upserted <> coalesce(array_length(v_changed, 1), 0) then
    raise exception using errcode = 'P0001', message = 'profile_field_cooldown';
  end if;

  -- ── Move between the official groups the replaced values created ──
  -- One move row per changed dimension: the community tied to the old value
  -- is left, the one tied to the new value is joined (upserting the
  -- community row the same way auto-join does at signup).
  for v_move in
    select mv.type, mv.old_ref, mv.new_ref, mv.new_master_name, mv.new_image
      from (values
        ('city', v_city_id, p_city_id,
          (select c.name from public.cities as c
            where c.id = p_city_id and c.is_active),
          (select c.image_url from public.cities as c
            where c.id = p_city_id and c.is_active)),
        ('sector', v_sector_id, p_sector_id,
          (select s.name from public.design_sectors as s
            where s.id = p_sector_id and s.is_active),
          (select s.image_url from public.design_sectors as s
            where s.id = p_sector_id and s.is_active)),
        ('experience_level',
          (select e.id from public.experience_levels as e where e.slug = v_experience_level),
          (select e.id from public.experience_levels as e where e.slug = p_experience_level),
          (select e.name from public.experience_levels as e
            where e.slug = p_experience_level and e.is_active),
          (select e.image_url from public.experience_levels as e
            where e.slug = p_experience_level and e.is_active)),
        ('job_title',
          (select j.id from public.job_titles as j where j.slug = v_job_title),
          (select j.id from public.job_titles as j where j.slug = p_job_title),
          (select j.name from public.job_titles as j
            where j.slug = p_job_title and j.is_active),
          (select j.image_url from public.job_titles as j
            where j.slug = p_job_title and j.is_active))
      ) as mv(type, old_ref, new_ref, new_master_name, new_image)
     where (mv.type = 'city' and v_city_changed)
        or (mv.type = 'sector' and v_sector_changed)
        or (mv.type = 'experience_level' and v_experience_changed)
        or (mv.type = 'job_title' and v_job_title_changed)
  loop
    -- Leave the group tied to the replaced value. Official groups are
    -- system-created and ownerless; the owner guard is a belt for the
    -- braces so a swap can never orphan a group someone owns.
    for v_group in
      select c.id, c.name, c.image_url
        from public.communities as c
       where c.type = v_move.type
         and c.reference_id = v_move.old_ref
         and v_move.old_ref is not null
         and (c.owner_id is null or c.owner_id <> p_user_id)
    loop
      delete from public.community_members as m
       where m.community_id = v_group.id
         and m.user_id = p_user_id;

      if found then
        delete from public.community_admin_permissions as p
         where p.community_id = v_group.id
           and p.user_id = p_user_id;

        v_left := v_left || jsonb_build_object(
          'id', v_group.id,
          'name', v_group.name,
          'image_url', v_group.image_url
        );
      end if;
    end loop;

    -- Join the group the new value implies. "Other" (the catch-all in the
    -- master tables) has no dedicated group — see auto-join — so those
    -- members stay in General, which is never touched here.
    if v_move.new_ref is not null
       and v_move.new_master_name is not null
       and lower(btrim(v_move.new_master_name)) <> 'other' then
      insert into public.communities as c (type, reference_id, name, image_url)
      values (
        v_move.type,
        v_move.new_ref,
        case v_move.type
          when 'city' then v_move.new_master_name || ' Designers'
          when 'sector' then v_move.new_master_name || ' Community'
          else v_move.new_master_name
        end,
        v_move.new_image
      )
      on conflict (type, reference_id) do update
        set name = excluded.name,
            image_url = excluded.image_url
      returning c.id, c.name, c.image_url
        into v_community_id, v_community_name, v_community_image;

      -- Best-effort under the 7-community cap (see the creation-limits
      -- migrations): an identity edit swaps groups net-neutrally — the old
      -- membership was deleted above — so the only case the cap bites is a
      -- member already at the cap who is setting this dimension for the
      -- first time (nothing to leave). The edit itself must never fail over
      -- that: the membership is skipped, not raised, and the member can join
      -- the group later from Explore. The count is the live one, so rooms
      -- the member cannot see (deactivated, ownerless) never block the join.
      select cl.limit_count into v_join_cap
        from public.creation_limits as cl
       where cl.kind = 'community_joins';

      v_member_count := public.count_join_slots(p_user_id);

      if v_member_count < coalesce(v_join_cap, 7) then
        insert into public.community_members (community_id, user_id)
        values (v_community_id, p_user_id)
        on conflict (community_id, user_id) do nothing;

        if found then
          v_joined := v_joined || jsonb_build_object(
            'id', v_community_id,
            'name', v_community_name,
            'image_url', v_community_image
          );
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'changed_fields', to_jsonb(v_changed),
    'left_communities', v_left,
    'joined_communities', v_joined
  );
end;
$function$;

CREATE VIEW "public"."company_directory_seed_retained" AS
 SELECT slug,
    name,
    domain,
    company_id,
    reason,
    claims,
    members,
    verifications,
    profile_pointers,
    verified_claims,
    observations,
    aliases,
    relationships,
    reviews,
    delegations
   FROM company_directory_seed_retirement_plan() plan(company_id, name, slug, domain, disposable, reason, claims, members, verifications, profile_pointers, verified_claims, observations, aliases, relationships, reviews, delegations)
  WHERE NOT disposable;

CREATE VIEW "public"."dm_blocks" AS
 SELECT id,
    blocker_id,
    blocked_id,
    created_at
   FROM user_blocks;

CREATE VIEW "public"."dm_report_queue" AS
 SELECT r.id,
    r.reporter_id,
        CASE
            WHEN r.reporter_id IS NULL THEN 'Deleted user'::text
            ELSE COALESCE(reporter.name, 'Member'::text)
        END AS reporter_name,
    r.reported_user_id,
    reported.name AS reported_user_name,
    r.conversation_id,
    r.reason,
    r.details,
    r.message_snapshot,
    r.status,
    r.resolved_at,
    r.created_at,
    r.reporter_deleted_at
   FROM dm_reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users reported ON reported.id = r.reported_user_id;

CREATE VIEW "public"."interaction_report_queue" AS
 SELECT r.id,
    r.reporter_id,
        CASE
            WHEN r.reporter_id IS NULL THEN 'Deleted user'::text
            ELSE COALESCE(reporter.name, 'Member'::text)
        END AS reporter_name,
    r.target_type,
    r.target_id,
    r.context_id,
    r.community_id,
    COALESCE(community.name, ''::text) AS community_name,
    r.target_author_id,
    COALESCE(author.name, r.target_author_name) AS target_author_name,
    r.target_excerpt,
    r.context_title,
    r.reason,
    r.details,
    r.status,
    r.resolved_at,
    r.created_at,
    r.resolved_by,
    r.target_snapshot,
    r.resolution_note,
    r.reporter_deleted_at
   FROM interaction_reports r
     LEFT JOIN users reporter ON reporter.id = r.reporter_id
     LEFT JOIN users author ON author.id = r.target_author_id
     LEFT JOIN communities community ON community.id = r.community_id;

CREATE VIEW "public"."report_groups" AS
 WITH grouped AS (
         SELECT r.content_type,
            r.content_id,
            (array_agg(DISTINCT r.community_id))[1] AS community_id,
            (array_agg(DISTINCT r.content_author_id))[1] AS content_author_id,
            (array_agg(DISTINCT r.content_title))[1] AS content_title,
            count(*)::integer AS report_count,
            count(*) FILTER (WHERE r.status = 'pending'::text)::integer AS pending_count,
            min(r.created_at) AS first_reported_at,
            max(r.created_at) AS last_reported_at,
            array_agg(DISTINCT r.reason) AS reasons,
            array_agg(DISTINCT r.reporter_id) AS reporter_ids,
                CASE
                    WHEN count(*) FILTER (WHERE r.status = 'pending'::text) > 0 THEN 'pending'::text
                    WHEN count(*) FILTER (WHERE r.status = 'removed'::text) > 0 THEN 'removed'::text
                    ELSE 'dismissed'::text
                END AS status
           FROM content_reports r
          GROUP BY r.content_type, r.content_id
        ), live AS (
         SELECT 'thread'::text AS content_type,
            t.id AS content_id,
            t.title,
            t.user_id,
            t.community_id
           FROM community_threads t
        UNION ALL
         SELECT 'showcase'::text,
            p.id,
            p.title,
            p.user_id,
            p.community_id
           FROM community_showcase_posts p
        UNION ALL
         SELECT 'resource'::text,
            r.id,
            r.title,
            r.user_id,
            r.community_id
           FROM community_resources r
        UNION ALL
         SELECT 'event'::text,
            e.id,
            e.title,
            e.user_id,
            e.community_id
           FROM community_events e
        )
 SELECT g.content_type,
    g.content_id,
    COALESCE(l.community_id, g.community_id) AS community_id,
    COALESCE(l.user_id, g.content_author_id) AS content_author_id,
    COALESCE(l.title, g.content_title::character varying) AS content_title,
    g.report_count,
    g.pending_count,
    g.status,
    g.reasons,
    g.reporter_ids,
    g.first_reported_at,
    g.last_reported_at,
    l.content_id IS NOT NULL AS content_exists,
    u.name AS author_name,
    c.name AS community_name,
    rn.names AS reporter_names,
    (EXISTS ( SELECT 1
           FROM content_removals cr
          WHERE cr.content_type = g.content_type AND cr.content_id = g.content_id AND cr.undone_at IS NULL)) AS can_restore
   FROM grouped g
     LEFT JOIN live l ON l.content_type = g.content_type AND l.content_id = g.content_id
     LEFT JOIN users u ON u.id = COALESCE(l.user_id, g.content_author_id)
     LEFT JOIN communities c ON c.id = COALESCE(l.community_id, g.community_id)
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT
                CASE
                    WHEN r2.reporter_id IS NULL THEN 'Deleted user'::text
                    ELSE COALESCE(ru.name, 'Member'::text)
                END) AS names
           FROM content_reports r2
             LEFT JOIN users ru ON ru.id = r2.reporter_id
          WHERE r2.content_type = g.content_type AND r2.content_id = g.content_id) rn ON true;

CREATE TRIGGER trg_applications_updated_at BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cities_updated_at BEFORE UPDATE ON cities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_communities_creation_limit BEFORE INSERT ON communities FOR EACH ROW EXECUTE FUNCTION enforce_community_creation_limit();

CREATE TRIGGER trg_communities_updated_at BEFORE UPDATE ON communities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_community_admin_permissions_updated_at BEFORE UPDATE ON community_admin_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_community_events_creation_limit BEFORE INSERT ON community_events FOR EACH ROW EXECUTE FUNCTION enforce_event_creation_limit();

CREATE TRIGGER trg_community_events_updated_at BEFORE UPDATE ON community_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_community_members_count AFTER INSERT OR DELETE ON community_members FOR EACH ROW EXECUTE FUNCTION sync_community_member_count();

CREATE TRIGGER trg_community_members_count_move AFTER UPDATE OF community_id ON community_members FOR EACH ROW WHEN (old.community_id IS DISTINCT FROM new.community_id) EXECUTE FUNCTION sync_community_member_count();

CREATE TRIGGER trg_community_members_join_cap BEFORE INSERT ON community_members FOR EACH ROW EXECUTE FUNCTION enforce_membership_cap();

CREATE TRIGGER trg_community_resources_creation_limit BEFORE INSERT ON community_resources FOR EACH ROW EXECUTE FUNCTION enforce_post_creation_limit();

CREATE TRIGGER trg_community_resources_updated_at BEFORE UPDATE ON community_resources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_community_showcase_creation_limit BEFORE INSERT ON community_showcase_posts FOR EACH ROW EXECUTE FUNCTION enforce_post_creation_limit();

CREATE TRIGGER trg_community_threads_creation_limit BEFORE INSERT ON community_threads FOR EACH ROW EXECUTE FUNCTION enforce_post_creation_limit();

CREATE TRIGGER trg_community_threads_updated_at BEFORE UPDATE ON community_threads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_design_sectors_updated_at BEFORE UPDATE ON design_sectors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON designer_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_dm_message_reactions_guard BEFORE INSERT OR UPDATE ON dm_message_reactions FOR EACH ROW EXECUTE FUNCTION dm_reaction_guard();

CREATE TRIGGER trg_dm_messages_guard BEFORE INSERT OR UPDATE OF user_id, conversation_id, reply_to_id ON dm_messages FOR EACH ROW EXECUTE FUNCTION dm_message_guard();

CREATE TRIGGER trg_dm_messages_touch_conversation AFTER INSERT ON dm_messages FOR EACH ROW EXECUTE FUNCTION dm_messages_touch_conversation();

CREATE TRIGGER trg_event_chat_join_responses_updated_at BEFORE UPDATE ON event_chat_join_responses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_event_comment_reactions_updated_at BEFORE UPDATE ON event_comment_reactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_event_comments_updated_at BEFORE UPDATE ON event_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_experience_levels_updated_at BEFORE UPDATE ON experience_levels FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_job_posts_creation_limit BEFORE INSERT ON job_posts FOR EACH ROW EXECUTE FUNCTION enforce_job_creation_limit();

CREATE TRIGGER trg_job_posts_guard_moderated_reopen BEFORE UPDATE ON job_posts FOR EACH ROW EXECUTE FUNCTION job_posts_guard_moderated_reopen();

CREATE TRIGGER trg_job_titles_updated_at BEFORE UPDATE ON job_titles FOR EACH ROW EXECUTE FUNCTION set_job_titles_updated_at();

CREATE TRIGGER trg_lottie_settings_updated_at BEFORE UPDATE ON lottie_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_moderation_audit_log_immutable BEFORE DELETE OR UPDATE ON moderation_audit_log FOR EACH ROW EXECUTE FUNCTION moderation_audit_log_immutable();

CREATE TRIGGER set_resource_comment_reactions_updated_at BEFORE UPDATE ON resource_comment_reactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_resource_comments_updated_at BEFORE UPDATE ON resource_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_showcase_comment_reactions_updated_at BEFORE UPDATE ON showcase_comment_reactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_showcase_comments_updated_at BEFORE UPDATE ON showcase_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_thread_comment_reactions_updated_at BEFORE UPDATE ON thread_comment_reactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_thread_comments_updated_at BEFORE UPDATE ON thread_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_anonymize_deleted_user_reports BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION anonymize_deleted_user_reports();

CREATE TRIGGER trg_handle_owned_communities_on_user_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION handle_owned_communities_on_user_delete();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "public"."account_verification_requests" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."account_verification_requests" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."account_verification_requests" TO "service_role";

COMMENT ON TABLE "public"."account_verification_requests" IS 'Account verification submissions and private work-sample keys. Client roles have no access.';

ALTER TABLE "public"."application_tags" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."application_tags" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."application_tags" TO "service_role";

ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."applications" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."applications" TO "service_role";

ALTER TABLE "public"."auth_sessions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."auth_sessions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."auth_sessions" TO "service_role";

COMMENT ON TABLE "public"."auth_sessions" IS 'One row per issued JWT. Revoked or expired rows are rejected by the web app and realtime service. Service-role only.';

ALTER TABLE "public"."cities" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."cities" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."cities" TO "service_role";

ALTER TABLE "public"."communities" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."communities" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."communities" TO "service_role";

ALTER TABLE "public"."community_admin_activity" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."community_admin_activity" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_admin_activity" TO "service_role";

ALTER TABLE "public"."community_admin_permissions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."community_admin_permissions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_admin_permissions" TO "service_role";

ALTER TABLE "public"."community_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."community_events" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."community_events" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_events" TO "service_role";

ALTER TABLE "public"."community_join_requests" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."community_join_requests" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_join_requests" TO "service_role";

ALTER TABLE "public"."community_members" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."community_members" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_members" TO "service_role";

ALTER TABLE "public"."community_messages" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."community_messages" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_messages" TO "service_role";

ALTER TABLE "public"."community_resources" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."community_resources" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."community_resources" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_resources" TO "service_role";

ALTER TABLE "public"."community_rules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."community_rules" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."community_rules" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_rules" TO "service_role";

ALTER TABLE "public"."community_showcase_posts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."community_showcase_posts" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."community_showcase_posts" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_showcase_posts" TO "service_role";

ALTER TABLE "public"."community_threads" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."community_threads" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."community_threads" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."community_threads" TO "service_role";

ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."companies" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."companies" TO "service_role";

ALTER TABLE "public"."company_aliases" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_aliases" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_aliases" TO "service_role";

COMMENT ON TABLE "public"."company_aliases" IS 'Search names for a company: aliases, former names, abbreviations. `alias_type` matters because a FORMER NAME must never merge two entities — "Facebook Inc." is how Meta Platforms used to be spelled, and it is not the Facebook brand entity.';

REVOKE ALL ON TABLE "public"."company_directory_seed_retained" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_directory_seed_retained" TO "service_role";

COMMENT ON VIEW "public"."company_directory_seed_retained" IS 'Seeded companies the reset refused to delete because a person or an operator had touched them, with the reason. Expected to be empty; each row is a decision for an operator, never a silent deletion.';

ALTER TABLE "public"."company_directory_seed_retired" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_directory_seed_retired" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_directory_seed_retired" TO "service_role";

COMMENT ON TABLE "public"."company_directory_seed_retired" IS 'The v1 directory seed''s own (name, domain) list, with the slug its company was created under. Written by supabase/reset/company_directory_seed_reset.sql so the retired rows stay identifiable after they are deleted; never written to again.';

ALTER TABLE "public"."company_domain_delegations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_domain_delegations" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_domain_delegations" TO "service_role";

COMMENT ON TABLE "public"."company_domain_delegations" IS 'The ONLY mechanism that lets one entity''s staff verify on another entity''s domain, and it is never inferred from a parent/subsidiary relationship. Grants nothing until review_status = reviewed and the evidence carries at least one CHECKED, non-supporting observation (see company_domain_delegation_allowed).';

ALTER TABLE "public"."company_domain_reviews" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_domain_reviews" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_domain_reviews" TO "service_role";

COMMENT ON TABLE "public"."company_domain_reviews" IS 'Append-only operator decisions about whether a company-domain claim''s evidence is strong enough for a mailbox proof to act on. Never deletes evidence, never writes `verified`, and always attributable to a reviewer.';

ALTER TABLE "public"."company_domains" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_domains" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_domains" TO "service_role";

ALTER TABLE "public"."company_email_verifications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_email_verifications" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_email_verifications" TO "service_role";

ALTER TABLE "public"."company_members" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_members" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_members" TO "service_role";

ALTER TABLE "public"."company_relationships" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."company_relationships" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."company_relationships" TO "service_role";

COMMENT ON TABLE "public"."company_relationships" IS 'Who owns whom, as structure only. No function in this migration reads it to answer a domain question: Meta owning WhatsApp must not make meta.com a WhatsApp domain or the reverse. A column on `companies` could not express a company that is both a parent and a subsidiary, nor a relationship that ends.';

ALTER TABLE "public"."content_reactions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."content_reactions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."content_reactions" TO "service_role";

ALTER TABLE "public"."content_removals" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."content_removals" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."content_removals" TO "service_role";

ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."content_reports" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."content_reports" TO "service_role";

COMMENT ON TABLE "public"."content_reports" IS 'User reports for posts; retained as moderation evidence after reporter deletion. Client roles have no access; reads/writes go through the service-role client.';

ALTER TABLE "public"."creation_limits" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."creation_limits" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."creation_limits" TO "service_role";

COMMENT ON TABLE "public"."creation_limits" IS 'Per-member creation budgets. The numbers live here so an operator can tune them with SQL and one migration note; the database raises limit:<kind> and the app maps the kind to user-facing copy. posts_daily, events_monthly, jobs_monthly, communities_total and community_joins are counted from LIVE rows (deleting frees the slot); only dms_monthly is recorded in usage_counters. Keep community_joins in sync with JOIN_LIMIT in apps/web/lib/communities/join-slots.ts.';

ALTER TABLE "public"."design_sectors" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."design_sectors" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."design_sectors" TO "service_role";

ALTER TABLE "public"."designer_profiles" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."designer_profiles" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."designer_profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."dm_blocks" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."dm_blocks" TO "service_role";

ALTER TABLE "public"."dm_conversations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."dm_conversations" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."dm_conversations" TO "service_role";

COMMENT ON TABLE "public"."dm_conversations" IS '1:1 DM conversations — canonical ordered pair, one row per pair.';

ALTER TABLE "public"."dm_message_reactions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."dm_message_reactions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."dm_message_reactions" TO "service_role";

COMMENT ON TABLE "public"."dm_message_reactions" IS 'One reaction per user per DM message; desired-state upserts keep rapid toggles idempotent.';

ALTER TABLE "public"."dm_messages" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."dm_messages" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."dm_messages" TO "service_role";

COMMENT ON TABLE "public"."dm_messages" IS 'Direct messages. Soft-deleted rows keep their shape with content and image wiped (deleted_at set).';

REVOKE ALL ON TABLE "public"."dm_report_queue" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."dm_report_queue" TO "service_role";

ALTER TABLE "public"."dm_reports" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."dm_reports" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."dm_reports" TO "service_role";

ALTER TABLE "public"."domain_evidence" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."domain_evidence" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."domain_evidence" TO "service_role";

COMMENT ON TABLE "public"."domain_evidence" IS 'One observed piece of evidence that a company uses a domain. Rows are the provenance of a claim: they are added and retired, never edited into agreement, and `checked` decides how far they can lift a confidence.';

ALTER TABLE "public"."event_chat_join_responses" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_chat_join_responses" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."event_chat_join_responses" TO "service_role";

ALTER TABLE "public"."event_comment_reactions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_comment_reactions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."event_comment_reactions" TO "service_role";

ALTER TABLE "public"."event_comments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."event_comments" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."event_comments" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."event_comments" TO "service_role";

ALTER TABLE "public"."event_likes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."event_likes" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."event_likes" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."event_likes" TO "service_role";

ALTER TABLE "public"."event_notification_deliveries" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_notification_deliveries" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."event_notification_deliveries" TO "service_role";

COMMENT ON TABLE "public"."event_notification_deliveries" IS 'Once-per-member-per-stage ledger for event lifecycle notifications, claimed before sending so overlapping cron ticks cannot double-notify.';

ALTER TABLE "public"."event_rsvps" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."event_rsvps" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."event_rsvps" TO "service_role";

ALTER TABLE "public"."event_saves" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."event_saves" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."event_saves" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."event_saves" TO "service_role";

ALTER TABLE "public"."experience_levels" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."experience_levels" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."experience_levels" TO "service_role";

ALTER TABLE "public"."fcm_tokens" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."fcm_tokens" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."fcm_tokens" TO "service_role";

COMMENT ON TABLE "public"."fcm_tokens" IS 'Android FCM device tokens for chat push. Client roles have no access.';

REVOKE ALL ON TABLE "public"."interaction_report_queue" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."interaction_report_queue" TO "service_role";

ALTER TABLE "public"."interaction_reports" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."interaction_reports" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."interaction_reports" TO "service_role";

ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."invitations" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."invitations" TO "service_role";

ALTER TABLE "public"."job_applications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."job_applications" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."job_applications" TO "service_role";

ALTER TABLE "public"."job_posts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."job_posts" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."job_posts" TO "service_role";

ALTER TABLE "public"."job_titles" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."job_titles" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."job_titles" TO "service_role";

ALTER TABLE "public"."library_items" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."library_items" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."library_items" TO "service_role";

COMMENT ON TABLE "public"."library_items" IS 'The member Library shelf: threads, showcase posts and resources the admin featured, with a 1..N order per kind. A deleted post cascades its row away.';

ALTER TABLE "public"."lottie_settings" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."lottie_settings" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."lottie_settings" TO "service_role";

ALTER TABLE "public"."member_resumes" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."member_resumes" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."member_resumes" TO "service_role";

COMMENT ON TABLE "public"."member_resumes" IS 'Saved résumés. Private object keys; client roles have no access, downloads go through the authorization-gated proxy.';

ALTER TABLE "public"."message_reactions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."message_reactions" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."message_reactions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."message_reactions" TO "service_role";

ALTER TABLE "public"."moderation_appeals" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."moderation_appeals" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."moderation_appeals" TO "service_role";

ALTER TABLE "public"."moderation_audit_log" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."moderation_audit_log" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."moderation_audit_log" TO "service_role";

ALTER TABLE "public"."moderation_audit_log_legacy_20261030" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."moderation_audit_log_legacy_20261030" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."moderation_audit_log_legacy_20261030" TO "service_role";

ALTER TABLE "public"."moderation_logs" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."moderation_logs" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."moderation_logs" TO "service_role";

ALTER TABLE "public"."moderation_settings" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."moderation_settings" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."moderation_settings" TO "service_role";

ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."notification_preferences" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."notification_preferences" TO "service_role";

ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."notifications" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."notifications" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."notifications" TO "service_role";

ALTER TABLE "public"."password_resets" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."password_resets" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."password_resets" TO "service_role";

ALTER TABLE "public"."profile_field_changes" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."profile_field_changes" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."profile_field_changes" TO "service_role";

COMMENT ON TABLE "public"."profile_field_changes" IS 'Last-change timestamps for the editable identity slots (name, job title, experience level, city, sector); each slot can change once per three months.';

ALTER TABLE "public"."push_throttle" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."push_throttle" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."push_throttle" TO "service_role";

ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."push_tokens" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."push_tokens" TO "service_role";

REVOKE ALL ON TABLE "public"."report_groups" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."report_groups" TO "service_role";

ALTER TABLE "public"."resource_bookmarks" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."resource_bookmarks" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."resource_bookmarks" TO "service_role";

ALTER TABLE "public"."resource_comment_reactions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."resource_comment_reactions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."resource_comment_reactions" TO "service_role";

ALTER TABLE "public"."resource_comments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."resource_comments" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."resource_comments" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."resource_comments" TO "service_role";

ALTER TABLE "public"."resource_saves" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."resource_saves" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."resource_saves" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."resource_saves" TO "service_role";

ALTER TABLE "public"."showcase_comment_reactions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."showcase_comment_reactions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."showcase_comment_reactions" TO "service_role";

ALTER TABLE "public"."showcase_comments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."showcase_comments" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."showcase_comments" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."showcase_comments" TO "service_role";

ALTER TABLE "public"."showcase_likes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."showcase_likes" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."showcase_likes" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."showcase_likes" TO "service_role";

ALTER TABLE "public"."showcase_saves" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."showcase_saves" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."showcase_saves" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."showcase_saves" TO "service_role";

ALTER TABLE "public"."signup_attempts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."signup_attempts" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."signup_attempts" TO "service_role";

ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."tags" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."tags" TO "service_role";

ALTER TABLE "public"."thread_comment_reactions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."thread_comment_reactions" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."thread_comment_reactions" TO "service_role";

ALTER TABLE "public"."thread_comments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."thread_comments" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."thread_comments" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."thread_comments" TO "service_role";

ALTER TABLE "public"."thread_likes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."thread_likes" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."thread_likes" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."thread_likes" TO "service_role";

ALTER TABLE "public"."thread_poll_votes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."thread_poll_votes" REPLICA IDENTITY FULL;

REVOKE ALL ON TABLE "public"."thread_poll_votes" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."thread_poll_votes" TO "service_role";

ALTER TABLE "public"."thread_saves" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."thread_saves" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."thread_saves" TO "service_role";

ALTER TABLE "public"."usage_counters" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."usage_counters" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."usage_counters" TO "service_role";

COMMENT ON TABLE "public"."usage_counters" IS 'Append-only usage records for the budgets that stay append-only — dms_monthly only, since posts/events/jobs are now counted from live rows.';

ALTER TABLE "public"."user_blocks" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_blocks" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."user_blocks" TO "service_role";

COMMENT ON TABLE "public"."user_blocks" IS 'Member-to-member blocks (formerly dm_blocks). One row per (blocker, blocked) pair; enforced on DMs, comments, chat replies and notifications.';

ALTER TABLE "public"."user_punishments" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_punishments" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."user_punishments" TO "service_role";

ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."users" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."users" TO "service_role";

ALTER TABLE "public"."verification_email_codes" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."verification_email_codes" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."verification_email_codes" TO "service_role";

COMMENT ON TABLE "public"."verification_email_codes" IS 'Hashed one-time codes for the account-email check. Service-role only.';

ALTER TABLE "public"."verification_settings" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."verification_settings" FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE "public"."verification_settings" TO "service_role";

COMMENT ON TABLE "public"."verification_settings" IS 'Singleton verification policy. grace_days delays the banner and write gate for new signups.';

CREATE POLICY "author_read" ON "public"."event_chat_join_responses" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.uid() = user_id));

CREATE POLICY "event_comment_reactions_delete_own" ON "public"."event_comment_reactions" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() = user_id));

CREATE POLICY "event_comment_reactions_insert_own" ON "public"."event_comment_reactions" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "event_likes_delete_own" ON "public"."event_likes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "event_likes_insert_own" ON "public"."event_likes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "event_saves_delete_own" ON "public"."event_saves" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "event_saves_insert_own" ON "public"."event_saves" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Members can delete own resumes" ON "public"."member_resumes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "Members can insert own resumes" ON "public"."member_resumes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Members can read own resumes" ON "public"."member_resumes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "Members can update own resumes" ON "public"."member_resumes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Members can insert own notification preferences" ON "public"."notification_preferences" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Members can read own notification preferences" ON "public"."notification_preferences" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "Members can update own notification preferences" ON "public"."notification_preferences" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "resource_comment_reactions_delete_own" ON "public"."resource_comment_reactions" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() = user_id));

CREATE POLICY "resource_comment_reactions_insert_own" ON "public"."resource_comment_reactions" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "showcase_comment_reactions_delete_own" ON "public"."showcase_comment_reactions" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() = user_id));

CREATE POLICY "showcase_comment_reactions_insert_own" ON "public"."showcase_comment_reactions" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "thread_comment_reactions_delete_own" ON "public"."thread_comment_reactions" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((auth.uid() = user_id));

CREATE POLICY "thread_comment_reactions_insert_own" ON "public"."thread_comment_reactions" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() = user_id));

REVOKE ALL ON FUNCTION "public"."admin_create_company"(p_name text, p_domain text, p_logo_url text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_create_company"(p_name text, p_domain text, p_logo_url text) TO "service_role";

COMMENT ON FUNCTION "public"."admin_create_company"(p_name text, p_domain text, p_logo_url text) IS 'Adds a company (unique slug from company_slugify, duplicate name refused) and, when given, one UNVERIFIED domain hint. verified is never written. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_delete_company"(p_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_delete_company"(p_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."admin_delete_company"(p_id uuid) IS 'Removes a company and, by cascade, its domains, memberships and pending challenges, then closes the gap it leaves in the design-first block. Returns false when the row did not exist. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_featured_companies"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_featured_companies"() TO "service_role";

COMMENT ON FUNCTION "public"."admin_featured_companies"() IS 'The design-first block — the companies the picker''s empty query shows first — in the order it shows them. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_join_all_communities"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_join_all_communities"(p_user_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."admin_join_all_communities"(p_user_id uuid) IS 'Operator override: joins the member into every community despite the join cap (transaction-local bypass), returns their total memberships.';

REVOKE ALL ON FUNCTION "public"."admin_library_candidates"(p_kind text, p_search text, p_sort text, p_offset integer, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_library_candidates"(p_kind text, p_search text, p_sort text, p_offset integer, p_limit integer) TO "service_role";

COMMENT ON FUNCTION "public"."admin_library_candidates"(p_kind text, p_search text, p_sort text, p_offset integer, p_limit integer) IS 'The library pick queue: every post of one kind with its engagement counts and shelf flag, ordered by engagement (likes + comments; resources: saves + comments) or recency. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_library_featured"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_library_featured"() TO "service_role";

COMMENT ON FUNCTION "public"."admin_library_featured"() IS 'Every post on the library shelf, in kind then position order, with its community, author and engagement counts. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_list_companies"(p_query text, p_all boolean, p_limit integer, p_offset integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_list_companies"(p_query text, p_all boolean, p_limit integer, p_offset integer) TO "service_role";

COMMENT ON FUNCTION "public"."admin_list_companies"(p_query text, p_all boolean, p_limit integer, p_offset integer) IS 'Admin company directory page: each company with its primary domain, proof flag, domain count, verified member count and its design-first position (null when it is not in the block), plus the match total. Search is by name or slug. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_move_company_featured"(p_id uuid, p_direction integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_move_company_featured"(p_id uuid, p_direction integer) TO "service_role";

COMMENT ON FUNCTION "public"."admin_move_company_featured"(p_id uuid, p_direction integer) IS 'Moves a company one position within the design-first block (-1 earlier, 1 later) and returns its new position; a move off either end changes nothing. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_move_library_item"(p_type text, p_id uuid, p_direction integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_move_library_item"(p_type text, p_id uuid, p_direction integer) TO "service_role";

COMMENT ON FUNCTION "public"."admin_move_library_item"(p_type text, p_id uuid, p_direction integer) IS 'Moves a shelf item one position within its kind (-1 earlier, 1 later) and returns its new position; a move off either end changes nothing. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_set_company_featured"(p_id uuid, p_featured boolean) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_set_company_featured"(p_id uuid, p_featured boolean) TO "service_role";

COMMENT ON FUNCTION "public"."admin_set_company_featured"(p_id uuid, p_featured boolean) IS 'Adds a company to the design-first block at the end, or removes it and closes the gap. Returns the position, or null once it is out. Refuses an inactive company. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_set_library_item"(p_type text, p_id uuid, p_featured boolean, p_curated_by uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_set_library_item"(p_type text, p_id uuid, p_featured boolean, p_curated_by uuid) TO "service_role";

COMMENT ON FUNCTION "public"."admin_set_library_item"(p_type text, p_id uuid, p_featured boolean, p_curated_by uuid) IS 'Puts a post on the library shelf at the end of its kind''s block, or takes it off and closes the gap. Returns the position, or null once it is off. Service-role only.';

REVOKE ALL ON FUNCTION "public"."admin_update_company"(p_id uuid, p_name text, p_is_active boolean, p_logo_url text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_update_company"(p_id uuid, p_name text, p_is_active boolean, p_logo_url text) TO "service_role";

COMMENT ON FUNCTION "public"."admin_update_company"(p_id uuid, p_name text, p_is_active boolean, p_logo_url text) IS 'Renames or activates/deactivates a company (a null argument leaves the field alone). A name another company already holds is refused. Deactivating also takes the company out of the design-first block. Service-role only.';

REVOKE ALL ON FUNCTION "public"."anonymize_deleted_user_reports"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."anonymize_deleted_user_reports"() TO "service_role";

COMMENT ON FUNCTION "public"."anonymize_deleted_user_reports"() IS 'Before a user row is deleted, removes the account link from every report they filed while retaining the report and its evidence.';

REVOKE ALL ON FUNCTION "public"."apply_to_job"(p_job_id uuid, p_applicant_id uuid, p_name text, p_portfolio_url text, p_linkedin_url text, p_resume_url text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."apply_to_job"(p_job_id uuid, p_applicant_id uuid, p_name text, p_portfolio_url text, p_linkedin_url text, p_resume_url text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."apply_to_job_with_resume"(p_job_id uuid, p_applicant_id uuid, p_name text, p_portfolio_url text, p_linkedin_url text, p_resume_key text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."apply_to_job_with_resume"(p_job_id uuid, p_applicant_id uuid, p_name text, p_portfolio_url text, p_linkedin_url text, p_resume_key text) TO "service_role";

COMMENT ON FUNCTION "public"."apply_to_job_with_resume"(p_job_id uuid, p_applicant_id uuid, p_name text, p_portfolio_url text, p_linkedin_url text, p_resume_key text) IS 'Creates a job application and attaches its private resume key in one transaction.';

REVOKE ALL ON FUNCTION "public"."bump_usage_counter"(p_user_id uuid, p_kind text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."bump_usage_counter"(p_user_id uuid, p_kind text) TO "service_role";

COMMENT ON FUNCTION "public"."bump_usage_counter"(p_user_id uuid, p_kind text) IS 'Atomic bump-and-check for a period budget; past the cap raises P0001 with message limit:<kind>, rolling the bump back with the caller''s transaction.';

REVOKE ALL ON FUNCTION "public"."change_user_password"(p_user_id uuid, p_password_hash text, p_keep_session_id uuid, p_expected_hash text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."change_user_password"(p_user_id uuid, p_password_hash text, p_keep_session_id uuid, p_expected_hash text) TO "service_role";

COMMENT ON FUNCTION "public"."change_user_password"(p_user_id uuid, p_password_hash text, p_keep_session_id uuid, p_expected_hash text) IS 'Updates the password hash (optimistically matched against the expected old hash) and revokes every other device, keeping the current session alive.';

REVOKE ALL ON FUNCTION "public"."company_confidence_meets_threshold"(p_confidence text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_confidence_meets_threshold"(p_confidence text) TO "service_role";

COMMENT ON FUNCTION "public"."company_confidence_meets_threshold"(p_confidence text) IS 'True for high/medium evidence. Below this, an OTP proves domain control only — it never turns a directory guess into verified company ownership.';

REVOKE ALL ON FUNCTION "public"."company_confidence_rank"(p_confidence text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_confidence_rank"(p_confidence text) TO "service_role";

COMMENT ON FUNCTION "public"."company_confidence_rank"(p_confidence text) IS 'High/medium/low/unknown as a number, so every rule that says "medium or better" ranks the same way.';

REVOKE ALL ON FUNCTION "public"."company_directory_seed_retirement_plan"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_directory_seed_retirement_plan"() TO "service_role";

COMMENT ON FUNCTION "public"."company_directory_seed_retirement_plan"() IS 'Per seeded company still present: whether nothing references it (disposable), which guard stops its removal when something does, and what would go with it. Read-only; the dry run before applying the reset.';

REVOKE ALL ON FUNCTION "public"."company_domain_claims"(p_domain text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_domain_claims"(p_domain text) TO "service_role";

COMMENT ON FUNCTION "public"."company_domain_claims"(p_domain text) IS 'Every claim on a domain with its evidence, including the ones a proof superseded. The audit view of a contested or surprising domain: nothing here is deleted for disagreeing with a proof.';

REVOKE ALL ON FUNCTION "public"."company_domain_delegation_allowed"(p_company_id uuid, p_domain text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_domain_delegation_allowed"(p_company_id uuid, p_domain text) TO "service_role";

COMMENT ON FUNCTION "public"."company_domain_delegation_allowed"(p_company_id uuid, p_domain text) IS 'True only when a REVIEWED delegation with checked, non-supporting evidence lets this company verify on this domain. Relationships, MX records and redirects are not consulted.';

REVOKE ALL ON FUNCTION "public"."company_domain_evidence_supports_promotion"(p_company_id uuid, p_domain text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_domain_evidence_supports_promotion"(p_company_id uuid, p_domain text) TO "service_role";

COMMENT ON FUNCTION "public"."company_domain_evidence_supports_promotion"(p_company_id uuid, p_domain text) IS 'Whether a checked, non-OTP observation of a kind that can speak to corporate mail exists for (company, domain). The gate on every promotion: without it the answer is needs_more_evidence, because OTP evidence is deliberately excluded.';

REVOKE ALL ON FUNCTION "public"."company_domain_owner"(p_domain text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_domain_owner"(p_domain text) TO "service_role";

COMMENT ON FUNCTION "public"."company_domain_owner"(p_domain text) IS 'Returns the company a normalised domain maps to. Prefers a verified owner; used to route a member to the right company instead of matching on the typed company name.';

REVOKE ALL ON FUNCTION "public"."company_domain_review_queue"(p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_domain_review_queue"(p_limit integer) TO "service_role";

COMMENT ON FUNCTION "public"."company_domain_review_queue"(p_limit integer) IS 'Domains where a member proved a mailbox but the claim''s evidence is too weak to verify it (`mailbox_only`: the member joined the company, the domain question is unsettled), with whatever a reviewer needs to decide: the claim''s confidence, the observations, and the last decision. Excludes verified claims and re-surfaces a rejected one only when new evidence has arrived.';

REVOKE ALL ON FUNCTION "public"."company_domain_steward"(p_domain text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_domain_steward"(p_domain text) TO "service_role";

COMMENT ON FUNCTION "public"."company_domain_steward"(p_domain text) IS 'The resolved owner of a domain: a proof if there is one, otherwise the strongest claim, with `contested` telling the caller that the answer is a tie rather than a decision. Answers "who is this domain?" for routing and for refusal copy; it never grants a claim.';

REVOKE ALL ON FUNCTION "public"."company_featured_renumber"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_featured_renumber"() TO "service_role";

COMMENT ON FUNCTION "public"."company_featured_renumber"() IS 'Rewrites companies.featured_rank as 1..N in its current order, so the picker''s first screen has no gaps and no ties. Internal: called by the admin functions, executable by nobody through the API.';

REVOKE ALL ON FUNCTION "public"."company_search_term"(p_query text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_search_term"(p_query text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."company_slugify"(p_name text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."company_slugify"(p_name text) TO "service_role";

COMMENT ON FUNCTION "public"."company_slugify"(p_name text) IS 'URL slug for a company name. Falls back to ''company'' when the name has no alphanumeric characters.';

REVOKE ALL ON FUNCTION "public"."complete_password_reset"(p_token text, p_password_hash text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."complete_password_reset"(p_token text, p_password_hash text) TO "service_role";

COMMENT ON FUNCTION "public"."complete_password_reset"(p_token text, p_password_hash text) IS 'Atomic reset: claims the token, changes the hash, bumps the session version and revokes every session.';

REVOKE ALL ON FUNCTION "public"."complete_signup"(p_name text, p_email text, p_password_hash text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text, p_avatar_url text, p_avatar_source text, p_invitation_token text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."complete_signup"(p_name text, p_email text, p_password_hash text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text, p_avatar_url text, p_avatar_source text, p_invitation_token text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_signup_with_consent"(p_name text, p_email text, p_password_hash text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text, p_avatar_url text, p_avatar_source text, p_age_confirmed boolean, p_terms_accepted boolean, p_terms_version text, p_invitation_token text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."complete_signup_with_consent"(p_name text, p_email text, p_password_hash text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text, p_avatar_url text, p_avatar_source text, p_age_confirmed boolean, p_terms_accepted boolean, p_terms_version text, p_invitation_token text) TO "service_role";

COMMENT ON FUNCTION "public"."complete_signup_with_consent"(p_name text, p_email text, p_password_hash text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text, p_avatar_url text, p_avatar_source text, p_age_confirmed boolean, p_terms_accepted boolean, p_terms_version text, p_invitation_token text) IS 'Creates an account and records age/Terms consent in the same transaction. Refuses false consent flags.';

REVOKE ALL ON FUNCTION "public"."confirm_company_verification"(p_user_id uuid, p_verification_id uuid, p_code_hash text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."confirm_company_verification"(p_user_id uuid, p_verification_id uuid, p_code_hash text) TO "service_role";

COMMENT ON FUNCTION "public"."confirm_company_verification"(p_user_id uuid, p_verification_id uuid, p_code_hash text) IS 'Commits a proved work email: creates or resolves the company, claims or promotes the domain, records the membership and points the profile at it. A correct code always grants the membership (verified_via = mailbox_only when the claim is too weak to verify the domain itself); it promotes the claim itself only when the evidence is high or medium, because a mailbox does not prove the directory mapped the domain correctly.';

REVOKE ALL ON FUNCTION "public"."count_join_slots"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."count_join_slots"(p_user_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."count_join_slots"(p_user_id uuid) IS 'Live communities the membership cap counts: non-event, active, and member-created ones only while they still have an owner. Archived memberships count — archive is a snooze, not a leave.';

REVOKE ALL ON FUNCTION "public"."count_live_creations"(p_user_id uuid, p_kind text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."count_live_creations"(p_user_id uuid, p_kind text) TO "service_role";

COMMENT ON FUNCTION "public"."count_live_creations"(p_user_id uuid, p_kind text) IS 'Rows the member still has alive inside the budget''s UTC window — threads + showcase + resources for posts_daily, events for events_monthly, job posts for jobs_monthly. Deleting content lowers the count, so the budget comes back.';

REVOKE ALL ON FUNCTION "public"."create_auth_session"(p_user_id uuid, p_role text, p_expires_at timestamp with time zone, p_user_agent text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_auth_session"(p_user_id uuid, p_role text, p_expires_at timestamp with time zone, p_user_agent text) TO "service_role";

COMMENT ON FUNCTION "public"."create_auth_session"(p_user_id uuid, p_role text, p_expires_at timestamp with time zone, p_user_agent text) IS 'Atomically reads the current account version and inserts the session row used by a newly-issued JWT.';

REVOKE ALL ON FUNCTION "public"."create_job_post"(p_poster_id uuid, p_kind text, p_company_id uuid, p_title text, p_city_id uuid, p_sector_id uuid, p_job_title text, p_experience_level text, p_work_mode text, p_employment_type text, p_salary text, p_description text, p_responsibilities text[], p_requirements text[], p_skills text[], p_website text, p_closes_at timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_job_post"(p_poster_id uuid, p_kind text, p_company_id uuid, p_title text, p_city_id uuid, p_sector_id uuid, p_job_title text, p_experience_level text, p_work_mode text, p_employment_type text, p_salary text, p_description text, p_responsibilities text[], p_requirements text[], p_skills text[], p_website text, p_closes_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_notification"(p_user_id uuid, p_actor_id uuid, p_community_id uuid, p_type text, p_entity_type text, p_entity_id uuid, p_title text, p_body text, p_href text, p_metadata jsonb) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_notification"(p_user_id uuid, p_actor_id uuid, p_community_id uuid, p_type text, p_entity_type text, p_entity_id uuid, p_title text, p_body text, p_href text, p_metadata jsonb) TO "service_role";

COMMENT ON FUNCTION "public"."create_notification"(p_user_id uuid, p_actor_id uuid, p_community_id uuid, p_type text, p_entity_type text, p_entity_id uuid, p_title text, p_body text, p_href text, p_metadata jsonb) IS 'M-4: inserts one unread notification per (user_id, entity_type, entity_id), or atomically aggregates a repeat event into the existing unread row. Returns inserted = true only when a new row was created, so callers publish the right realtime event.';

REVOKE ALL ON FUNCTION "public"."creation_limits_bypassed"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."creation_limits_bypassed"() TO "service_role";

COMMENT ON FUNCTION "public"."creation_limits_bypassed"() IS 'True while the session/transaction carries app.bypass_creation_limits = on (admin RPCs and SQL test fixtures only).';

REVOKE ALL ON FUNCTION "public"."creation_window_start"(p_period text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."creation_window_start"(p_period text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."delete_job_post"(p_actor_id uuid, p_job_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."delete_job_post"(p_actor_id uuid, p_job_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."dm_message_guard"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."dm_message_guard"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."dm_messages_touch_conversation"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."dm_messages_touch_conversation"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."dm_messages_touch_conversation"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."dm_messages_touch_conversation"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."dm_messages_touch_conversation"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."dm_reaction_guard"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."dm_reaction_guard"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_community_creation_limit"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_community_creation_limit"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."enforce_community_creation_limit"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."enforce_community_creation_limit"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_community_creation_limit"() TO "service_role";

COMMENT ON FUNCTION "public"."enforce_community_creation_limit"() IS 'Up to 5 member-created communities per member, counted live: deleting one returns the budget. Creating also needs a free join slot.';

REVOKE ALL ON FUNCTION "public"."enforce_event_creation_limit"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_event_creation_limit"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."enforce_event_creation_limit"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."enforce_event_creation_limit"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_event_creation_limit"() TO "service_role";

COMMENT ON FUNCTION "public"."enforce_event_creation_limit"() IS 'Up to 5 hosted events per member per UTC calendar month, in any community. Counted from live rows, so deleting an event frees a slot.';

REVOKE ALL ON FUNCTION "public"."enforce_job_creation_limit"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_job_creation_limit"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."enforce_job_creation_limit"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."enforce_job_creation_limit"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_job_creation_limit"() TO "service_role";

COMMENT ON FUNCTION "public"."enforce_job_creation_limit"() IS 'Up to 3 job posts per member per UTC calendar month. Counted from live rows: deleting a post frees a slot, closing one does not.';

REVOKE ALL ON FUNCTION "public"."enforce_membership_cap"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_membership_cap"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."enforce_membership_cap"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."enforce_membership_cap"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_membership_cap"() TO "service_role";

COMMENT ON FUNCTION "public"."enforce_membership_cap"() IS 'Standing cap of 10 live communities per member (event rooms excluded, deactivated and ownerless rooms not charged), with a per-member advisory lock against parallel joins.';

REVOKE ALL ON FUNCTION "public"."enforce_post_creation_limit"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_post_creation_limit"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."enforce_post_creation_limit"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."enforce_post_creation_limit"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_post_creation_limit"() TO "service_role";

COMMENT ON FUNCTION "public"."enforce_post_creation_limit"() IS 'Threads, showcase posts and resources share one daily budget — 3 posts a day across the whole app. Counted from live rows, so deleting a post frees a slot.';

REVOKE ALL ON FUNCTION "public"."get_admin_community_members_page"(p_community_id uuid, p_search text, p_limit integer, p_offset integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_admin_community_members_page"(p_community_id uuid, p_search text, p_limit integer, p_offset integer) TO "service_role";

COMMENT ON FUNCTION "public"."get_admin_community_members_page"(p_community_id uuid, p_search text, p_limit integer, p_offset integer) IS 'Admin member-picker page: returns only the requested page of a community''s members (joined_at order, user_id tie-break) with name and email, plus the match total. Service-role only; the /api/admin/communities/[id]/members route enforces the admin session.';

REVOKE ALL ON FUNCTION "public"."get_all_communities"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_all_communities"(p_user_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."get_all_communities"(p_user_id uuid) IS 'Returns the response-ready active community explore list in one query (event group chats excluded). member_count is read from communities.member_count rather than aggregated from community_members. has_pending_request is true when the caller has an unresolved join request for the community.';

REVOKE ALL ON FUNCTION "public"."get_community_members_page"(p_community_id uuid, p_search text, p_limit integer, p_offset integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_community_members_page"(p_community_id uuid, p_search text, p_limit integer, p_offset integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_community_message_page"(p_community_id uuid, p_user_id uuid, p_history_start timestamp with time zone, p_before timestamp with time zone, p_after timestamp with time zone, p_limit integer, p_content_ids uuid[], p_before_id uuid, p_after_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_community_message_page"(p_community_id uuid, p_user_id uuid, p_history_start timestamp with time zone, p_before timestamp with time zone, p_after timestamp with time zone, p_limit integer, p_content_ids uuid[], p_before_id uuid, p_after_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_company_page"(p_slug text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_company_page"(p_slug text) TO "service_role";

COMMENT ON FUNCTION "public"."get_company_page"(p_slug text) IS 'Public company page payload: the display domain (verified when one exists, else the directory hint) that the picture resolves from, plus verified domains, verified member count and a recent-member preview. Never exposes member work emails.';

REVOKE ALL ON FUNCTION "public"."get_dm_conversations"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_dm_conversations"(p_user_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."get_dm_conversations"(p_user_id uuid) IS 'DM conversation list: peer identity, last-message preview, viewer unread count, newest reaction event and the request state; rejected conversations and the viewer''s blocked peers are omitted.';

REVOKE ALL ON FUNCTION "public"."get_dm_message_page"(p_conversation_id uuid, p_user_id uuid, p_before timestamp with time zone, p_before_id uuid, p_after timestamp with time zone, p_after_id uuid, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_dm_message_page"(p_conversation_id uuid, p_user_id uuid, p_before timestamp with time zone, p_before_id uuid, p_after timestamp with time zone, p_after_id uuid, p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_dm_unread_total"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_dm_unread_total"(p_user_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_event_attendee_previews"(p_event_ids uuid[], p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_event_attendee_previews"(p_event_ids uuid[], p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_event_list_aggregates"(p_user_id uuid, p_event_ids uuid[]) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_event_list_aggregates"(p_user_id uuid, p_event_ids uuid[]) TO "service_role";

COMMENT ON FUNCTION "public"."get_event_list_aggregates"(p_user_id uuid, p_event_ids uuid[]) IS 'Returns interaction aggregates for one authorized event list page.';

REVOKE ALL ON FUNCTION "public"."get_event_list_page"(p_community_id uuid, p_user_id uuid, p_phase text, p_cursor_event_date timestamp with time zone, p_cursor_id uuid, p_now timestamp with time zone, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_event_list_page"(p_community_id uuid, p_user_id uuid, p_phase text, p_cursor_event_date timestamp with time zone, p_cursor_id uuid, p_now timestamp with time zone, p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_home_feed_interactions"(p_user_id uuid, p_thread_ids uuid[], p_event_ids uuid[], p_resource_ids uuid[]) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_home_feed_interactions"(p_user_id uuid, p_thread_ids uuid[], p_event_ids uuid[], p_resource_ids uuid[]) TO "service_role";

COMMENT ON FUNCTION "public"."get_home_feed_interactions"(p_user_id uuid, p_thread_ids uuid[], p_event_ids uuid[], p_resource_ids uuid[]) IS 'Returns set-based interaction counts and caller state for one bounded home-feed page.';

REVOKE ALL ON FUNCTION "public"."get_home_feed_page"(p_user_id uuid, p_before timestamp with time zone, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_home_feed_page"(p_user_id uuid, p_before timestamp with time zone, p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_home_feed_page"(p_user_id uuid, p_before timestamp with time zone, p_limit integer, p_member_only boolean) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_home_feed_page"(p_user_id uuid, p_before timestamp with time zone, p_limit integer, p_member_only boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_home_feed_page"(p_user_id uuid, p_before timestamp with time zone, p_limit integer, p_scope text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_home_feed_page"(p_user_id uuid, p_before timestamp with time zone, p_limit integer, p_scope text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_job_applicants"(p_poster_id uuid, p_job_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_job_applicants"(p_poster_id uuid, p_job_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_job_detail"(p_job_id uuid, p_viewer_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_job_detail"(p_job_id uuid, p_viewer_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_job_feed"(p_viewer_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_job_feed"(p_viewer_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_library_page"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_library_page"(p_user_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."get_library_page"(p_user_id uuid) IS 'The member Library shelf: every picked post p_user_id may see (public, or in a community they belong to), projected exactly like get_member_feed_page with every interaction flag resolved for the viewer, ordered by kind then shelf position.';

REVOKE ALL ON FUNCTION "public"."get_member_feed_page"(p_viewer_id uuid, p_author_id uuid, p_scope text, p_before timestamp with time zone, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_member_feed_page"(p_viewer_id uuid, p_author_id uuid, p_scope text, p_before timestamp with time zone, p_limit integer) TO "service_role";

COMMENT ON FUNCTION "public"."get_member_feed_page"(p_viewer_id uuid, p_author_id uuid, p_scope text, p_before timestamp with time zone, p_limit integer) IS 'Member profile activity: cards authored by p_author_id that p_viewer_id may see (public, or in a community the viewer belongs to), projected exactly like get_profile_feed_page with every interaction flag resolved for the viewer.';

REVOKE ALL ON FUNCTION "public"."get_or_create_dm_conversation"(p_me uuid, p_peer uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_or_create_dm_conversation"(p_me uuid, p_peer uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_pending_company_verification"(p_user_id uuid, p_verification_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_pending_company_verification"(p_user_id uuid, p_verification_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_profile_feed_page"(p_user_id uuid, p_scope text, p_before timestamp with time zone, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_profile_feed_page"(p_user_id uuid, p_scope text, p_before timestamp with time zone, p_limit integer) TO "service_role";

COMMENT ON FUNCTION "public"."get_profile_feed_page"(p_user_id uuid, p_scope text, p_before timestamp with time zone, p_limit integer) IS 'Profile activity: cards authored by p_user_id on all/kind scopes; the Saved scope lists what p_user_id saved (bookmarks for resources). Same card payload as get_home_feed_page with every interaction flag resolved for the member.';

REVOKE ALL ON FUNCTION "public"."get_resource_list_aggregates"(p_user_id uuid, p_resource_ids uuid[]) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_resource_list_aggregates"(p_user_id uuid, p_resource_ids uuid[]) TO "service_role";

COMMENT ON FUNCTION "public"."get_resource_list_aggregates"(p_user_id uuid, p_resource_ids uuid[]) IS 'Returns interaction aggregates and the allow_replies flag for one authorized resource list page.';

REVOKE ALL ON FUNCTION "public"."get_resource_list_page"(p_community_id uuid, p_user_id uuid, p_before timestamp with time zone, p_cursor_id uuid, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_resource_list_page"(p_community_id uuid, p_user_id uuid, p_before timestamp with time zone, p_cursor_id uuid, p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_showcase_interactions"(p_user_id uuid, p_post_ids uuid[]) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_showcase_interactions"(p_user_id uuid, p_post_ids uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_showcase_list_page"(p_community_id uuid, p_user_id uuid, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_showcase_list_page"(p_community_id uuid, p_user_id uuid, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_limit integer) TO "service_role";

COMMENT ON FUNCTION "public"."get_showcase_list_page"(p_community_id uuid, p_user_id uuid, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_limit integer) IS 'Returns one authorized showcase page with author and interaction aggregates.';

REVOKE ALL ON FUNCTION "public"."get_sidebar_activity"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_sidebar_activity"(p_user_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."get_sidebar_activity"(p_user_id uuid) IS 'Sidebar projection: per-community unread counts, last message, last reaction (message OR content card) and newest content item for a user. Unread scans are bounded by the read watermark; newest-row lookups use LIMIT 1 laterals. member_count is read from communities.member_count, never counted from community_members.';

REVOKE ALL ON FUNCTION "public"."get_thread_list_aggregates"(p_user_id uuid, p_thread_ids uuid[]) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_thread_list_aggregates"(p_user_id uuid, p_thread_ids uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_thread_list_page"(p_community_id uuid, p_user_id uuid, p_before timestamp with time zone, p_cursor_id uuid, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_thread_list_page"(p_community_id uuid, p_user_id uuid, p_before timestamp with time zone, p_cursor_id uuid, p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_unread_message_totals"(p_user_ids uuid[]) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_unread_message_totals"(p_user_ids uuid[]) TO "service_role";

COMMENT ON FUNCTION "public"."get_unread_message_totals"(p_user_ids uuid[]) IS 'Icon-badge totals per member; scans start at greatest(last_read_at, joined_at) so the count is bounded by what can still be unread.';

REVOKE ALL ON FUNCTION "public"."get_user_company"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_user_company"(p_user_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."get_user_company"(p_user_id uuid) IS 'The company a member displays on their profile: the display domain (verified when one exists, else the directory hint) and the member''s own verified membership flag.';

REVOKE ALL ON FUNCTION "public"."handle_owned_communities_on_user_delete"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."handle_owned_communities_on_user_delete"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."handle_owned_communities_on_user_delete"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."handle_owned_communities_on_user_delete"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."handle_owned_communities_on_user_delete"() TO "service_role";

COMMENT ON FUNCTION "public"."handle_owned_communities_on_user_delete"() IS 'Before a user is deleted, unlinks every room pointing at an event they host, then hands each community they own to the longest-standing remaining member — or deletes the community when it would be left with no owner.';

REVOKE ALL ON FUNCTION "public"."is_content_restore"(p_content_type text, p_content_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_content_restore"(p_content_type text, p_content_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."is_content_restore"(p_content_type text, p_content_id uuid) IS 'True when this content id has been removed by moderation before, i.e. the insert putting it back is an undo rather than a new post.';

REVOKE ALL ON FUNCTION "public"."job_post_is_open"(p_status text, p_closes_at timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."job_post_is_open"(p_status text, p_closes_at timestamp with time zone) TO "service_role";

COMMENT ON FUNCTION "public"."job_post_is_open"(p_status text, p_closes_at timestamp with time zone) IS 'Whether a posting accepts applications right now: the owner has not closed it and no deadline has passed. The single rule behind can_apply, the feed filter and apply_to_job.';

REVOKE ALL ON FUNCTION "public"."job_post_payload"(p_job_id uuid, p_viewer_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."job_post_payload"(p_job_id uuid, p_viewer_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."job_posts_guard_moderated_reopen"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."job_posts_guard_moderated_reopen"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."job_posts_guard_moderated_reopen"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."job_posts_guard_moderated_reopen"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."job_posts_guard_moderated_reopen"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."leave_company"(p_user_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."leave_company"(p_user_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."library_featured_renumber"(p_type text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."library_featured_renumber"(p_type text) TO "service_role";

COMMENT ON FUNCTION "public"."library_featured_renumber"(p_type text) IS 'Rewrites one kind''s library block as 1..N in its current order, so the shelf has no gaps and no ties. Internal: executable by nobody through the API.';

REVOKE ALL ON FUNCTION "public"."mark_dm_conversation_read"(p_conversation_id uuid, p_user_id uuid, p_last_read_at timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_dm_conversation_read"(p_conversation_id uuid, p_user_id uuid, p_last_read_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."moderation_audit_log_immutable"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."moderation_audit_log_immutable"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."moderation_audit_log_immutable"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."moderation_audit_log_immutable"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."moderation_audit_log_immutable"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."reassign_company_domain"(p_domain text, p_from_company_id uuid, p_to_company_id uuid, p_reason text, p_actor_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."reassign_company_domain"(p_domain text, p_from_company_id uuid, p_to_company_id uuid, p_reason text, p_actor_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."reassign_company_domain"(p_domain text, p_from_company_id uuid, p_to_company_id uuid, p_reason text, p_actor_id uuid) IS 'Moves a PROVED domain to another company: unverifies the old claim (keeping it as history), retires it as evidence of the operator decision, adds a medium-confidence claim for the new company, and leaves every membership alone. The new company still has to prove a mailbox.';

REVOKE ALL ON FUNCTION "public"."retire_company_directory_seed"(p_dry_run boolean, p_allow_retained boolean) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."retire_company_directory_seed"(p_dry_run boolean, p_allow_retained boolean) TO "service_role";

COMMENT ON FUNCTION "public"."retire_company_directory_seed"(p_dry_run boolean, p_allow_retained boolean) IS 'Removes the v1 seed''s companies and their unverified claims, and nothing else. Every other referencing table is a guard: a seeded row a member or an operator has touched is kept and reported by company_directory_seed_retained, and while one exists the removal raises unless p_allow_retained is true. Call with p_dry_run => true for the counts without deleting.';

REVOKE ALL ON FUNCTION "public"."review_account_verification"(p_request_id uuid, p_action text, p_reason text, p_reviewed_by text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."review_account_verification"(p_request_id uuid, p_action text, p_reason text, p_reviewed_by text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."review_company_domain"(p_domain text, p_company_id uuid, p_reviewer_id uuid, p_decision text, p_reason text, p_confidence text, p_evidence_id uuid) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."review_company_domain"(p_domain text, p_company_id uuid, p_reviewer_id uuid, p_decision text, p_reason text, p_confidence text, p_evidence_id uuid) TO "service_role";

COMMENT ON FUNCTION "public"."review_company_domain"(p_domain text, p_company_id uuid, p_reviewer_id uuid, p_decision text, p_reason text, p_confidence text, p_evidence_id uuid) IS 'Records an operator decision about a company-domain claim. `promote` lifts the claim''s evidence to high/medium so a proved mailbox can verify it — it never writes `verified` itself, never deletes an observation, and refuses when another company has already proved the domain (reassignment is the path for that). Every decision carries reviewer_id, reason and timestamp.';

REVOKE ALL ON FUNCTION "public"."revoke_all_admin_sessions"(p_reason text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."revoke_all_admin_sessions"(p_reason text) TO "service_role";

COMMENT ON FUNCTION "public"."revoke_all_admin_sessions"(p_reason text) IS 'Revokes every environment-admin session. Rotating ADMIN_PASSWORD also invalidates them through the JWT admin fingerprint.';

REVOKE ALL ON FUNCTION "public"."revoke_all_user_sessions"(p_user_id uuid, p_reason text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."revoke_all_user_sessions"(p_user_id uuid, p_reason text) TO "service_role";

COMMENT ON FUNCTION "public"."revoke_all_user_sessions"(p_user_id uuid, p_reason text) IS 'Logout-all, password reset and suspension. Bumps users.session_version and revokes every registry row.';

REVOKE ALL ON FUNCTION "public"."revoke_auth_session"(p_session_id uuid, p_reason text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."revoke_auth_session"(p_session_id uuid, p_reason text) TO "service_role";

COMMENT ON FUNCTION "public"."revoke_auth_session"(p_session_id uuid, p_reason text) IS 'Revokes one device session. Used by logout and by admin logout.';

REVOKE ALL ON FUNCTION "public"."revoke_other_user_sessions"(p_user_id uuid, p_keep_session_id uuid, p_reason text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."revoke_other_user_sessions"(p_user_id uuid, p_keep_session_id uuid, p_reason text) TO "service_role";

COMMENT ON FUNCTION "public"."revoke_other_user_sessions"(p_user_id uuid, p_keep_session_id uuid, p_reason text) IS 'Password change: revokes every device except the one making the change. Does not bump the global version.';

REVOKE ALL ON FUNCTION "public"."search_companies"(p_query text, p_limit integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."search_companies"(p_query text, p_limit integer) TO "service_role";

COMMENT ON FUNCTION "public"."search_companies"(p_query text, p_limit integer) IS 'Directory search by name, slug, alias or verified domain, each arm index-backed. An empty query browses the directory with the curated design block first (companies.featured_rank), then name order. Reports the company''s primary domain (verified first, then the strongest claim) with `verified` and `evidence_confidence` so a caller can tell a proof from a hint.';

REVOKE ALL ON FUNCTION "public"."set_experience_levels_updated_at"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_experience_levels_updated_at"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_experience_levels_updated_at"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."set_experience_levels_updated_at"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_experience_levels_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_job_application_status"(p_actor_id uuid, p_application_id uuid, p_status text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_job_application_status"(p_actor_id uuid, p_application_id uuid, p_status text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_job_post_status"(p_actor_id uuid, p_job_id uuid, p_status text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_job_post_status"(p_actor_id uuid, p_job_id uuid, p_status text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_job_titles_updated_at"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_job_titles_updated_at"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_job_titles_updated_at"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."set_job_titles_updated_at"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_job_titles_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_user_blocked"(p_user_id uuid, p_blocked boolean, p_reason text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_user_blocked"(p_user_id uuid, p_blocked boolean, p_reason text) TO "service_role";

COMMENT ON FUNCTION "public"."set_user_blocked"(p_user_id uuid, p_blocked boolean, p_reason text) IS 'Blocks or unblocks an account, bumps its session version and revokes every session. Unblocking still requires a fresh login.';

REVOKE ALL ON FUNCTION "public"."set_user_suspended"(p_user_id uuid, p_until timestamp with time zone, p_reason text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_user_suspended"(p_user_id uuid, p_until timestamp with time zone, p_reason text) TO "service_role";

COMMENT ON FUNCTION "public"."set_user_suspended"(p_user_id uuid, p_until timestamp with time zone, p_reason text) IS 'Applies or lifts a temporary suspension, bumps the session version and revokes every live session.';

REVOKE ALL ON FUNCTION "public"."start_company_verification"(p_user_id uuid, p_domain text, p_work_email text, p_code_hash text, p_company_id uuid, p_company_name text, p_ttl_minutes integer) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."start_company_verification"(p_user_id uuid, p_domain text, p_work_email text, p_code_hash text, p_company_id uuid, p_company_name text, p_ttl_minutes integer) TO "service_role";

COMMENT ON FUNCTION "public"."start_company_verification"(p_user_id uuid, p_domain text, p_work_email text, p_code_hash text, p_company_id uuid, p_company_name text, p_ttl_minutes integer) IS 'Opens a work-email challenge. Refuses a domain another company has verified (offering the owner), accepts any claim of the selected company, accepts another company''s domain only through a reviewed delegation, lets a weak directory hint be superseded instead of reserving a domain, and reports the claim''s confidence so the caller knows whether the code can establish the company or only domain control.';

REVOKE ALL ON FUNCTION "public"."sync_community_member_count"() FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_community_member_count"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."sync_community_member_count"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."sync_community_member_count"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."sync_community_member_count"() TO "service_role";

COMMENT ON FUNCTION "public"."sync_community_member_count"() IS 'Keeps communities.member_count equal to the number of community_members rows for the community. Fired by trg_community_members_count (INSERT/DELETE) and trg_community_members_count_move (community_id changes).';

REVOKE ALL ON FUNCTION "public"."update_job_post"(p_actor_id uuid, p_job_id uuid, p_title text, p_city_id uuid, p_sector_id uuid, p_job_title text, p_experience_level text, p_work_mode text, p_employment_type text, p_salary text, p_description text, p_responsibilities text[], p_requirements text[], p_skills text[], p_website text, p_closes_at timestamp with time zone) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_job_post"(p_actor_id uuid, p_job_id uuid, p_title text, p_city_id uuid, p_sector_id uuid, p_job_title text, p_experience_level text, p_work_mode text, p_employment_type text, p_salary text, p_description text, p_responsibilities text[], p_requirements text[], p_skills text[], p_website text, p_closes_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_profile_identity"(p_user_id uuid, p_name text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text) FROM PUBLIC, "anon", "authenticated", "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_profile_identity"(p_user_id uuid, p_name text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text) TO "service_role";

COMMENT ON FUNCTION "public"."update_profile_identity"(p_user_id uuid, p_name text, p_city_id uuid, p_sector_id uuid, p_experience_level text, p_job_title text) IS 'Atomic identity edit: per-field cooldown gate, profile update and official-group swap; returns the changed fields and the groups left/joined.';

COMMENT ON COLUMN "public"."account_verification_requests"."work_sample_keys" IS 'Private R2 object keys, parallel to work_sample_urls. New submissions fill this and leave work_sample_urls empty.';

COMMENT ON COLUMN "public"."auth_sessions"."session_version" IS 'The users.session_version value the JWT was issued with. A mismatch invalidates the session even if this row was not revoked.';

COMMENT ON COLUMN "public"."communities"."image_url" IS 'Public URL of the community photo stored in Cloudflare R2.';

COMMENT ON COLUMN "public"."communities"."is_public" IS 'When true the community is visible in Explore Communities. When false it is hidden (admin-managed or invite-only).';

COMMENT ON COLUMN "public"."communities"."member_count" IS 'Number of rows in community_members for this community. Maintained by the trg_community_members_count* triggers on community_members; never write it from application code.';

COMMENT ON COLUMN "public"."community_events"."community_id" IS 'The community this event belongs to.';

COMMENT ON COLUMN "public"."community_events"."is_public" IS 'When true, any logged-in user can view this event and comment on it.';

COMMENT ON COLUMN "public"."community_events"."accent_color" IS 'Hex accent color for the event card theming; null means the default yellow.';

COMMENT ON COLUMN "public"."community_members"."notifications_muted_until" IS 'Timed mute: muted while the deadline is ahead; expired values are left in place and read as unmuted (see notifications_muted for the forever switch).';

COMMENT ON COLUMN "public"."community_resources"."community_id" IS 'The community this resource belongs to.';

COMMENT ON COLUMN "public"."community_resources"."is_public" IS 'When true, any logged-in user can view this resource and comment on it.';

COMMENT ON COLUMN "public"."community_showcase_posts"."community_id" IS 'The community this showcase post belongs to.';

COMMENT ON COLUMN "public"."community_showcase_posts"."is_public" IS 'When true, any logged-in user can view this showcase post on the home feed.';

COMMENT ON COLUMN "public"."community_showcase_posts"."attachments" IS 'Uploaded media (images + videos) shown in a carousel. Each item: {name, url, type, size}.';

COMMENT ON COLUMN "public"."community_threads"."community_id" IS 'The community this thread belongs to.';

COMMENT ON COLUMN "public"."community_threads"."is_public" IS 'When true, logged-in users can view this thread in the public home feed.';

COMMENT ON COLUMN "public"."companies"."entity_status" IS 'What the registry layers say about the entity: active, dissolved, acquired. Ordering and search read it; `unknown` is the honest default for a row nobody has checked.';

COMMENT ON COLUMN "public"."companies"."source" IS 'Which layer produced this row (curated, wikidata-p856, a registry id). Provenance, not an authority: nothing derives a verified domain from it.';

COMMENT ON COLUMN "public"."companies"."source_id" IS 'The source''s own identifier for this entity (Companies House company_number, an LEI, a Wikidata QID). With `source` it is the legal identity; the row''s UUID is the internal handle that never changes.';

COMMENT ON COLUMN "public"."companies"."jurisdiction" IS 'The registry jurisdiction the identity belongs to (GB, US-DE, …), which is what keeps two same-named companies in different countries two rows instead of one merge.';

COMMENT ON COLUMN "public"."companies"."directory_rank" IS 'Deterministic order for the directory: evidence-bearing companies first, then confidence, then notability. A rank is a position in a list, NOT a company size.';

COMMENT ON COLUMN "public"."companies"."featured_rank" IS 'Position in the curated design-first block that the picker''s empty query leads with. NULL (the default) means not featured: the row browses in name order after the block. Hand-curated — unlike directory_rank, which the import derives from evidence.';

COMMENT ON COLUMN "public"."company_domains"."domain_type" IS 'What KIND of domain this is: a website, a mail domain, a brand, a regional or historical domain. `primary_website` is the default because a directory seed knows a website, not a mail domain.';

COMMENT ON COLUMN "public"."company_domains"."evidence_confidence" IS 'How strong the evidence for this claim is: high, medium, low, unknown. NEVER upgraded by proving the domain — `verified` records the proof, and these are two different facts.';

COMMENT ON COLUMN "public"."company_domains"."source" IS 'Which layer asserted this claim (curated, wikidata-p856, an operator). Read by the report and the re-check job.';

COMMENT ON COLUMN "public"."content_reports"."reporter_deleted_at" IS 'When the reporter account was erased. reporter_id is null from then on; the report is retained as evidence.';

COMMENT ON COLUMN "public"."content_reports"."target_snapshot" IS 'Immutable copy of the reported post fields (title, body, media, links, created_at, author/community ids) captured when the report was filed.';

COMMENT ON COLUMN "public"."dm_conversations"."request_state" IS 'Request lifecycle: pending (first message awaits the recipient''s answer) / accepted / rejected. Pre-request-flow rows are accepted.';

COMMENT ON COLUMN "public"."dm_conversations"."requested_by" IS 'Author of the pending request''s first message — the one-sided sender. Null until the first message lands.';

COMMENT ON COLUMN "public"."dm_messages"."image_key" IS 'Object key in the private R2 bucket. image_url is the stable /api/private/dm/… path clients render.';

COMMENT ON COLUMN "public"."dm_reports"."reporter_deleted_at" IS 'When the reporter account was erased. reporter_id is null from then on; the report is retained as evidence.';

COMMENT ON COLUMN "public"."interaction_reports"."reporter_deleted_at" IS 'When the reporter account was erased. reporter_id is null from then on; the report is retained as evidence.';

COMMENT ON COLUMN "public"."job_applications"."resume_key" IS 'Object key in the private R2 bucket. Takes precedence over the legacy resume_url.';

COMMENT ON COLUMN "public"."job_posts"."city_id" IS 'The posting''s city, or NULL for All cities — the dimension then matches every member.';

COMMENT ON COLUMN "public"."job_posts"."sector_id" IS 'The posting''s sector, or NULL for All sectors — the dimension then matches every member.';

COMMENT ON COLUMN "public"."member_resumes"."storage_key" IS 'Object key in the private R2 bucket. Takes precedence over url; url is the legacy public copy.';

COMMENT ON COLUMN "public"."moderation_appeals"."user_deleted_at" IS 'When the appealing account was erased. The appeal and its audit trail are retained.';

COMMENT ON COLUMN "public"."moderation_audit_log"."moderator_id" IS 'Historical moderator account id at action time. Deliberately not a foreign key: audit rows are append-only and must never be rewritten by account deletion.';

COMMENT ON COLUMN "public"."moderation_audit_log"."report_id" IS 'Historical report id at action time. Deliberately not a foreign key: audit rows are append-only and must never be rewritten by an evidence-retention purge.';

COMMENT ON COLUMN "public"."moderation_audit_log"."subject_user_id" IS 'Historical affected-account id at action time. Deliberately not a foreign key: audit rows are append-only and must never be rewritten by account deletion.';

COMMENT ON COLUMN "public"."moderation_audit_log"."moderator_label" IS 'Moderator display name captured when the action was taken, so attribution survives deletion of the moderator account.';

COMMENT ON COLUMN "public"."users"."verification_status" IS 'unverified | pending | approved | rejected. Only approved accounts may write.';

COMMENT ON COLUMN "public"."users"."verification_reapply_at" IS 'Rejected members may submit a new request at this time (one month after review).';

COMMENT ON COLUMN "public"."users"."verification_notified_at" IS 'When the reapply-eligible email was sent, so the cron never sends it twice.';

COMMENT ON COLUMN "public"."users"."email_verified_at" IS 'Set when the member confirms the OTP sent to their account email.';

COMMENT ON COLUMN "public"."users"."age_confirmed_at" IS 'When the member confirmed at signup that they are 18 or older.';

COMMENT ON COLUMN "public"."users"."terms_accepted_at" IS 'When the member accepted the Terms of Service, Community Guidelines and Privacy Policy.';

COMMENT ON COLUMN "public"."users"."session_version" IS 'Bumped by logout-all, password reset, suspension and unblocking. A JWT is valid only when its sv claim matches this value.';

COMMENT ON COLUMN "public"."users"."terms_version" IS 'Published Terms/Privacy version accepted at signup. NULL for accounts created before versioned consent or not yet re-consented.';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM PUBLIC, "anon", "authenticated", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public" GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM PUBLIC, "anon", "authenticated", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public" GRANT EXECUTE ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public" REVOKE ALL ON TABLES FROM PUBLIC, "anon", "authenticated", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "public" GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" REVOKE ALL ON SEQUENCES FROM PUBLIC, "anon", "authenticated", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" REVOKE ALL ON FUNCTIONS FROM PUBLIC, "anon", "authenticated", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT EXECUTE ON FUNCTIONS TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT EXECUTE ON FUNCTIONS TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT EXECUTE ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" REVOKE ALL ON TABLES FROM PUBLIC, "anon", "authenticated", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "storage" GRANT INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO "service_role";

-- Intended protection: independent community-update push switch.

ALTER TABLE public.notification_preferences ADD COLUMN community_push_enabled boolean NOT NULL DEFAULT true;

-- Ordinary UNIQUE permits multiple NULLs for direct signups.

ALTER TABLE public.users ADD CONSTRAINT users_application_id_unique UNIQUE (application_id);

NOTIFY pgrst, 'reload schema';
