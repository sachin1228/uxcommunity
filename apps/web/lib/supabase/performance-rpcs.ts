import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { HomeFeedScope } from "@/lib/feeds/home-feed-options";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

type AggregateBase = { id: string };

type PerformanceRpcMap = {
  get_community_message_page: {
    args: { p_community_id: string; p_user_id: string; p_history_start: string; p_before: string | null; p_after: string | null; p_limit: number; p_content_ids: string[] | null };
    returns: Array<{ id: string; content: string | null; created_at: string; user_id: string; reply_to_id: string | null; reply_to_content_id: string | null; image_url: string | null; deleted_at: string | null; edited_at: string | null; deleted_by: string | null; deleted_by_role: string | null; mentions: Json; users: Json; reactions: Json; reply_to: Json; reply_to_content: Json; content_reactions: Json }>;
  };
  get_sidebar_activity: { args: { p_user_id: string }; returns: Json };
  get_all_communities: {
    args: { p_user_id: string };
    returns: Array<{
      id: string;
      name: string;
      type: string;
      image_url: string | null;
      description: string | null;
      is_private: boolean;
      member_count: number;
      joined: boolean;
      can_join: boolean;
    }>;
  };
  get_community_members_page: {
    args: { p_community_id: string; p_search: string | null; p_limit: number; p_offset: number };
    returns: Array<{ user_id: string; joined_at: string; role: string; name: string; total: number }>;
  };
  get_admin_community_members_page: {
    args: { p_community_id: string; p_search: string | null; p_limit: number; p_offset: number };
    returns: Array<{ user_id: string; joined_at: string; role: string; name: string; email: string; total: number }>;
  };
  create_notification: {
    args: {
      p_user_id: string;
      p_actor_id: string | null;
      p_community_id: string | null;
      p_type: string;
      p_entity_type: string;
      p_entity_id: string;
      p_title: string;
      p_body: string | null;
      p_href: string;
      p_metadata: Json;
    };
    returns: Array<{
      id: string;
      user_id: string;
      actor_id: string | null;
      community_id: string | null;
      type: string;
      entity_type: string;
      entity_id: string;
      title: string;
      body: string | null;
      href: string;
      metadata: Json;
      read_at: string | null;
      created_at: string;
      inserted: boolean;
    }>;
  };
  get_showcase_interactions: { args: { p_user_id: string; p_post_ids: string[] }; returns: Json };
  get_showcase_list_page: {
    args: { p_community_id: string; p_user_id: string; p_cursor_created_at: string | null; p_cursor_id: string | null; p_limit: number };
    returns: Array<AggregateBase & { community_id: string; user_id: string; title: string; image_url: string; category: string; is_public: boolean; allow_replies: boolean; created_at: string; updated_at: string; author: Json; like_count: number; comment_count: number; user_liked: boolean; user_saved: boolean }>;
  };
  get_thread_list_aggregates: { args: { p_user_id: string; p_thread_ids: string[] }; returns: Array<AggregateBase & { like_count: number; comment_count: number; user_liked: boolean; user_saved: boolean }> };
  get_event_list_aggregates: { args: { p_user_id: string; p_event_ids: string[] }; returns: Array<AggregateBase & { rsvp_count: number; like_count: number; save_count: number; user_rsvped: boolean; user_liked: boolean; user_saved: boolean }> };
  get_event_attendee_previews: { args: { p_event_ids: string[]; p_limit: number }; returns: Array<AggregateBase & { rsvps: Json }> };
  get_resource_list_aggregates: { args: { p_user_id: string; p_resource_ids: string[] }; returns: Array<AggregateBase & { save_count: number; comment_count: number; bookmark_count: number; user_saved: boolean; user_bookmarked: boolean; allow_replies: boolean }> };
  get_thread_list_page: { args: { p_community_id: string; p_user_id: string; p_before: string | null; p_cursor_id: string | null; p_limit: number }; returns: Array<{ item: Json }> };
  get_resource_list_page: { args: { p_community_id: string; p_user_id: string; p_before: string | null; p_cursor_id: string | null; p_limit: number }; returns: Array<{ item: Json }> };
  get_event_list_page: { args: { p_community_id: string; p_user_id: string; p_phase: "upcoming" | "past"; p_cursor_event_date: string | null; p_cursor_id: string | null; p_now: string; p_limit: number }; returns: Array<{ item: Json }> };
  get_home_feed_page: { args: { p_user_id: string; p_before: string | null; p_limit: number; p_scope: HomeFeedScope }; returns: Array<{ item: Json }> };
  get_profile_feed_page: { args: { p_user_id: string; p_scope: ProfileFeedScope; p_before: string | null; p_limit: number }; returns: Array<{ item: Json }> };
  get_member_feed_page: { args: { p_viewer_id: string; p_author_id: string; p_scope: MemberFeedScope; p_before: string | null; p_limit: number }; returns: Array<{ item: Json }> };
  // ─── Companies (verified work domains) ───
  // All company rules live in these functions (see
  // supabase/migrations/20260929120000_company_verified_domains.sql); the API
  // routes only supply the session user id, so the client never dictates which
  // company or domain a membership lands on.
  search_companies: {
    args: { p_query: string; p_limit: number };
    returns: Array<{
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      domain: string | null;
      verified: boolean;
      member_count: number;
    }>;
  };
  company_domain_owner: {
    args: { p_domain: string };
    returns: Array<{ company_id: string; name: string; slug: string; verified: boolean }>;
  };
  get_user_company: {
    args: { p_user_id: string };
    returns: Array<{
      company_id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      is_active: boolean;
      domain: string | null;
      domain_verified: boolean;
      membership_verified: boolean;
      joined_at: string | null;
    }>;
  };
  get_pending_company_verification: {
    args: { p_user_id: string; p_verification_id: string | null };
    returns: Array<{
      verification_id: string;
      company_id: string | null;
      company_name: string;
      domain: string;
      work_email: string;
      attempts_left: number;
      expires_at: string;
      created_at: string;
    }>;
  };
  start_company_verification: {
    args: {
      p_user_id: string;
      p_domain: string;
      p_work_email: string;
      p_code_hash: string;
      p_company_id: string | null;
      p_company_name: string | null;
      p_ttl_minutes: number;
    };
    returns: Array<{
      verification_id: string;
      company_id: string | null;
      company_name: string;
      domain: string;
      work_email: string;
      expires_at: string;
    }>;
  };
  confirm_company_verification: {
    args: { p_user_id: string; p_verification_id: string; p_code_hash: string };
    returns: Array<{
      status: string;
      attempts_left: number | null;
      company_id: string | null;
      company_name: string | null;
      company_slug: string | null;
      company_logo_url: string | null;
      domain: string | null;
      joined_at: string | null;
      domain_owner_company_id: string | null;
      /** `own_domain` | `delegation` | `mailbox_only`. */
      verified_via: string | null;
      claim_confidence: string | null;
    }>;
  };
  leave_company: { args: { p_user_id: string }; returns: boolean };
  get_company_page: {
    args: { p_slug: string };
    returns: Array<{
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      is_active: boolean;
      created_at: string;
      member_count: number;
      domains: Json;
      members: Json;
    }>;
  };
  // ─── Jobs (verified-company postings) ───
  // All job rules live in these functions (see
  // supabase/migrations/20261009120000_jobs.sql); the API routes only supply
  // the session user id, so a request can never post without a verified
  // company or apply without a profile match.
  create_job_post: {
    args: {
      p_poster_id: string;
      p_kind: string;
      p_company_id: string;
      p_title: string;
      p_city_id: string;
      p_sector_id: string;
      p_job_title: string;
      p_experience_level: string;
      p_work_mode: string;
      p_employment_type: string;
      p_salary: string | null;
      p_description: string;
      p_responsibilities: string[];
      p_requirements: string[];
      p_skills: string[];
      p_website: string | null;
    };
    returns: Array<{ job_id: string; created_at: string }>;
  };
  apply_to_job: {
    args: {
      p_job_id: string;
      p_applicant_id: string;
      p_name: string;
      p_portfolio_url: string;
      p_linkedin_url: string;
      p_resume_url: string | null;
    };
    returns: Array<{ application_id: string; created_at: string }>;
  };
  get_job_feed: {
    args: { p_viewer_id: string; p_limit: number };
    returns: Array<{ item: Json }>;
  };
  get_job_detail: {
    args: { p_job_id: string; p_viewer_id: string };
    returns: Array<{ item: Json }>;
  };
  get_job_applicants: {
    args: { p_poster_id: string; p_job_id: string };
    returns: Array<{ item: Json }>;
  };
  // The owner-side writes (see 20261009170000_job_lifecycle.sql). Like the
  // rest, the actor id is the session user and the function re-checks that
  // the posting is theirs, so a request can never edit or delete another
  // member's posting.
  update_job_post: {
    args: {
      p_actor_id: string;
      p_job_id: string;
      p_title: string;
      p_city_id: string;
      p_sector_id: string;
      p_job_title: string;
      p_experience_level: string;
      p_work_mode: string;
      p_employment_type: string;
      p_salary: string | null;
      p_description: string;
      /** NULL means "leave the stored list alone" (update_job_post only). */
      p_responsibilities: string[] | null;
      p_requirements: string[] | null;
      p_skills: string[] | null;
      p_website: string | null;
    };
    returns: Array<{ job_id: string; edited_at: string | null }>;
  };
  set_job_post_status: {
    args: { p_actor_id: string; p_job_id: string; p_status: string };
    returns: Array<{ job_id: string; job_status: string }>;
  };
  delete_job_post: {
    args: { p_actor_id: string; p_job_id: string };
    returns: Array<{ job_id: string }>;
  };
};

/** Card scopes the profile activity tabs can request. */
export const PROFILE_FEED_SCOPES = ["all", "thread", "showcase", "resource", "event", "saved"] as const;
export type ProfileFeedScope = (typeof PROFILE_FEED_SCOPES)[number];

export function isProfileFeedScope(value: string): value is ProfileFeedScope {
  return (PROFILE_FEED_SCOPES as readonly string[]).includes(value);
}

/** Scopes a member's profile can request — the owner's `saved` list is private. */
export const MEMBER_FEED_SCOPES = ["all", "thread", "showcase", "resource", "event"] as const;
export type MemberFeedScope = (typeof MEMBER_FEED_SCOPES)[number];

export function isMemberFeedScope(value: string): value is MemberFeedScope {
  return (MEMBER_FEED_SCOPES as readonly string[]).includes(value);
}

type RpcResult<T> = Promise<{ data: T | null; error: PostgrestError | null }>;

/** Keeps performance RPC contracts checked locally until generated DB types are refreshed. */
export function callPerformanceRpc<Name extends keyof PerformanceRpcMap>(
  client: SupabaseClient,
  name: Name,
  args: PerformanceRpcMap[Name]["args"],
): RpcResult<PerformanceRpcMap[Name]["returns"]> {
  return client.rpc(name, args) as unknown as RpcResult<PerformanceRpcMap[Name]["returns"]>;
}
