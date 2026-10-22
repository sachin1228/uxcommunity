import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";
import { CREATION_LIMIT_MESSAGES } from "@/lib/creation-limits";

/**
 * The standing membership cap. The referee is the database — the
 * community_joins row in public.creation_limits plus the membership trigger
 * (supabase/migrations/20261013120000_creation_limits.sql, refined by
 * 20261014140000_creation_limits_live_slots.sql and set to 10 by
 * 20261022190000_creation_limits_refund.sql). This mirror exists only
 * for the paths that must look before they write: the join-request
 * pre-checks, and auto-join slicing its groups down to the remaining slots.
 * Keep JOIN_LIMIT and the live predicate in sync with those migrations.
 */
export const JOIN_LIMIT = 10;

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

/** True when memberships + pending requests already fill the cap. */
export function isCapFull(slots: JoinSlots): boolean {
  return slots.memberships + slots.pendingRequests >= JOIN_LIMIT;
}

/**
 * The refusal copy says what the member's slots actually are — "6 in, 1
 * pending" reads as exactly that instead of the generic line. The pending
 * flavour only appears when pending requests are part of the reason; the
 * plain all-joined case keeps the standing copy (CREATION_LIMIT_MESSAGES).
 */
function pendingDetail(slots: JoinSlots, subject: "you" | "they"): string {
  const requests = `${slots.pendingRequests} join request${slots.pendingRequests === 1 ? "" : "s"}`;
  return subject === "you"
    ? `You're in ${slots.memberships} communities and have ${requests} pending — that takes up your ${JOIN_LIMIT} slots.`
    : `This member is in ${slots.memberships} communities and has ${requests} pending — that takes up their ${JOIN_LIMIT} slots.`;
}

/** Join refusal shown to the member trying to join or request a community. */
export function joinCapMessage(slots: JoinSlots): string {
  if (slots.pendingRequests === 0) return CREATION_LIMIT_MESSAGES.community_joins;
  return `${pendingDetail(slots, "you")} Leave one or wait for a request to be answered.`;
}

/** Create-community refusal — the creator joins what they make. */
export function createCapMessage(slots: JoinSlots): string {
  if (slots.pendingRequests === 0) return CREATION_LIMIT_MESSAGES.create_at_join_cap;
  return `${pendingDetail(slots, "you")} Leave one before creating your own.`;
}

/** Third-person refusal read by the manager who tried to accept the member. */
export function memberCapMessage(slots: JoinSlots): string {
  if (slots.pendingRequests === 0) {
    return `This member is already in their ${JOIN_LIMIT} communities. They need to leave one first.`;
  }
  return `${pendingDetail(slots, "they")} They need to leave one first.`;
}
