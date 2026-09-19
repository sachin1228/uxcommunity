import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

type AggregateBase = { id: string };

type PerformanceRpcMap = {
  get_community_message_page: {
    args: { p_community_id: string; p_user_id: string; p_history_start: string; p_before: string | null; p_after: string | null; p_limit: number };
    returns: Array<{ id: string; content: string | null; created_at: string; user_id: string; reply_to_id: string | null; image_url: string | null; deleted_at: string | null; edited_at: string | null; mentions: Json; users: Json; reactions: Json; reply_to: Json }>;
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
  get_competition_entries: {
    args: {
      p_competition_id: string;
      p_user_id: string;
      p_sort: string;
      p_limit: number;
      p_offset: number;
    };
    returns: Array<{
      id: string;
      competition_id: string;
      user_id: string;
      title: string;
      description: string;
      cover_image_url: string;
      design_image_url: string;
      image_urls: Json;
      figma_url: string | null;
      prototype_url: string | null;
      tools: Json;
      tags: Json;
      is_featured: boolean;
      created_at: string;
      updated_at: string;
      author_name: string;
      author_avatar_url: string | null;
      author_role: string | null;
      vote_count: number;
      comment_count: number;
      user_voted: boolean;
      user_bookmarked: boolean;
    }>;
  };
  get_competition_entry: {
    args: { p_competition_id: string; p_entry_id: string; p_user_id: string };
    returns: PerformanceRpcMap["get_competition_entries"]["returns"];
  };
  get_competition_stats: {
    args: { p_competition_id: string };
    returns: Array<{
      entries: number;
      designers: number;
      votes: number;
      comments: number;
      participants: number;
    }>;
  };
  get_competition_stats_bulk: {
    args: { p_competition_ids: string[] };
    returns: Array<{
      competition_id: string;
      entries: number;
      designers: number;
      votes: number;
      comments: number;
      participants: number;
    }>;
  };
  get_competition_winners: {
    args: { p_competition_ids: string[] };
    returns: Array<{
      competition_id: string;
      entry_id: string;
      user_id: string;
      title: string;
      cover_image_url: string;
      design_image_url: string;
      author_name: string;
      author_avatar_url: string | null;
      vote_count: number;
    }>;
  };
  get_home_feed_page: { args: { p_user_id: string; p_before: string | null; p_limit: number }; returns: Array<{ item: Json }> };
  get_profile_feed_page: { args: { p_user_id: string; p_scope: ProfileFeedScope; p_before: string | null; p_limit: number }; returns: Array<{ item: Json }> };
};

/** Card scopes the profile activity tabs can request. */
export const PROFILE_FEED_SCOPES = ["all", "thread", "showcase", "resource", "event", "saved"] as const;
export type ProfileFeedScope = (typeof PROFILE_FEED_SCOPES)[number];

export function isProfileFeedScope(value: string): value is ProfileFeedScope {
  return (PROFILE_FEED_SCOPES as readonly string[]).includes(value);
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
