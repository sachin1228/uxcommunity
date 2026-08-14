import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

type AggregateBase = { id: string };

type PerformanceRpcMap = {
  get_community_message_page: {
    args: { p_community_id: string; p_user_id: string; p_history_start: string; p_before: string | null; p_after: string | null; p_limit: number };
    returns: Array<{ id: string; content: string | null; created_at: string; user_id: string; reply_to_id: string | null; image_url: string | null; deleted_at: string | null; users: Json; reactions: Json; reply_to: Json }>;
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
    returns: Array<AggregateBase & { community_id: string; user_id: string; title: string; description: string; image_url: string; project_url: string | null; post_type: string; category: string; tags: string[]; created_at: string; updated_at: string; author: Json; like_count: number; comment_count: number; user_liked: boolean; user_saved: boolean }>;
  };
  get_thread_list_aggregates: { args: { p_user_id: string; p_thread_ids: string[] }; returns: Array<AggregateBase & { vote_count: number; comment_count: number; user_voted: boolean; user_saved: boolean }> };
  get_event_list_aggregates: { args: { p_user_id: string; p_event_ids: string[] }; returns: Array<AggregateBase & { rsvp_count: number; like_count: number; save_count: number; user_rsvped: boolean; user_liked: boolean; user_saved: boolean }> };
  get_resource_list_aggregates: { args: { p_user_id: string; p_resource_ids: string[] }; returns: Array<AggregateBase & { save_count: number; comment_count: number; bookmark_count: number; user_saved: boolean; user_bookmarked: boolean }> };
  get_thread_list_page: { args: { p_community_id: string; p_user_id: string; p_limit: number }; returns: Array<{ item: Json }> };
  get_resource_list_page: { args: { p_community_id: string; p_user_id: string; p_limit: number }; returns: Array<{ item: Json }> };
  get_event_list_page: { args: { p_community_id: string; p_user_id: string; p_phase: "upcoming" | "past"; p_cursor_event_date: string | null; p_cursor_id: string | null; p_now: string; p_limit: number }; returns: Array<{ item: Json }> };
  get_home_feed_page: { args: { p_user_id: string; p_before: string | null; p_limit: number }; returns: Array<{ item: Json }> };
};

type RpcResult<T> = Promise<{ data: T | null; error: PostgrestError | null }>;

/** Keeps performance RPC contracts checked locally until generated DB types are refreshed. */
export function callPerformanceRpc<Name extends keyof PerformanceRpcMap>(
  client: SupabaseClient,
  name: Name,
  args: PerformanceRpcMap[Name]["args"],
): RpcResult<PerformanceRpcMap[Name]["returns"]> {
  return client.rpc(name, args) as unknown as RpcResult<PerformanceRpcMap[Name]["returns"]>;
}
