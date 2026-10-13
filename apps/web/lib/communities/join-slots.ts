import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";

/**
 * The standing membership cap. The referee is the database — the
 * community_joins row in public.creation_limits plus the membership trigger
 * (supabase/migrations/20261013120000_creation_limits.sql). This mirror
 * exists only for the paths that must look before they write: the
 * join-request pre-checks, and auto-join slicing its groups down to the
 * remaining slots. Keep JOIN_LIMIT in sync with that migration.
 */
export const JOIN_LIMIT = 7;

type Db = ReturnType<typeof createServiceClient>;

export interface JoinSlots {
  /** Live memberships the cap counts — everything except event group chats. */
  memberships: number;
  /** Pending join requests: each holds a prospective slot. */
  pendingRequests: number;
}

/** How many of the member's community slots are spoken for right now. */
export async function loadJoinSlots(db: Db, userId: string): Promise<JoinSlots> {
  const [membershipsResult, pendingResult] = await Promise.all([
    db
      .from("community_members")
      .select("community_id, communities(type)")
      .eq("user_id", userId),
    db
      .from("community_join_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending"),
  ]);

  const rows = (membershipsResult.data ?? []) as Array<{
    communities: { type: string | null } | null;
  }>;
  const memberships = rows.filter((row) => row.communities?.type !== "event").length;

  return { memberships, pendingRequests: pendingResult.count ?? 0 };
}

/** True when this member cannot take on another non-event community slot. */
export async function isJoinCapped(db: Db, userId: string): Promise<boolean> {
  const { memberships, pendingRequests } = await loadJoinSlots(db, userId);
  return memberships + pendingRequests >= JOIN_LIMIT;
}
