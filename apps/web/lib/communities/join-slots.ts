import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";

/**
 * The standing membership cap. The referee is the database — the
 * community_joins row in public.creation_limits plus the membership trigger
 * (supabase/migrations/20261013120000_creation_limits.sql, refined by
 * 20261014140000_creation_limits_live_slots.sql). This mirror exists only
 * for the paths that must look before they write: the join-request
 * pre-checks, and auto-join slicing its groups down to the remaining slots.
 * Keep JOIN_LIMIT and the live predicate in sync with those migrations.
 */
export const JOIN_LIMIT = 7;

type Db = ReturnType<typeof createServiceClient>;

export interface JoinSlots {
  /** Live memberships the cap counts — see `isLiveMembership`. */
  memberships: number;
  /** Pending join requests: each holds a prospective slot. */
  pendingRequests: number;
}

/**
 * Mirror of public.count_join_slots (20261014140000_creation_limits_live_slots):
 * a slot is charged only for LIVE communities — never event group chats,
 * never deactivated rooms (their leave route 404s and the sidebar hides
 * them), and member-created rooms only while they still have an owner.
 * Archived memberships still count: archive is a snooze, not a leave.
 */
function isLiveMembership(row: {
  communities: { type: string | null; is_active: boolean | null; owner_id: string | null } | null;
}): boolean {
  const community = row.communities;
  if (!community) return false;
  if (community.type === "event") return false;
  if (community.is_active !== true) return false;
  if (community.type === "user" && community.owner_id === null) return false;
  return true;
}

/** How many of the member's community slots are spoken for right now. */
export async function loadJoinSlots(db: Db, userId: string): Promise<JoinSlots> {
  const [membershipsResult, pendingResult] = await Promise.all([
    db
      .from("community_members")
      .select("community_id, communities(type, is_active, owner_id)")
      .eq("user_id", userId),
    db
      .from("community_join_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending"),
  ]);

  const rows = (membershipsResult.data ?? []) as Array<{
    communities: { type: string | null; is_active: boolean | null; owner_id: string | null } | null;
  }>;
  const memberships = rows.filter(isLiveMembership).length;

  return { memberships, pendingRequests: pendingResult.count ?? 0 };
}

/** True when this member cannot take on another non-event community slot. */
export async function isJoinCapped(db: Db, userId: string): Promise<boolean> {
  const { memberships, pendingRequests } = await loadJoinSlots(db, userId);
  return memberships + pendingRequests >= JOIN_LIMIT;
}
