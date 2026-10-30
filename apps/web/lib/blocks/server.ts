import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceClient } from "@/lib/supabase/service";
import { blockedPeerIds } from "@/lib/blocks/peer-blocks";

/**
 * Member-to-member blocks.
 *
 * `user_blocks` holds one row per (blocker, blocked) pair. A block is a
 * boundary in both directions: neither member may DM, comment on, reply to or
 * notify the other. Profile pages already reshape themselves around it.
 *
 * The table is not in the generated Database types yet, so the one helper
 * below is the untyped hop — the same pattern the report queue uses for its
 * view. Column names are literals, never request input.
 */
function blocksTable(db: ServiceClient) {
  return (db as unknown as SupabaseClient).from("user_blocks");
}

/** True when a block exists between the two members in either direction. */
export async function isBlockedWith(
  db: ServiceClient,
  userId: string,
  otherId: string | null | undefined,
): Promise<boolean> {
  if (!otherId || otherId === userId) return false;
  const { data } = await blocksTable(db)
    .select("blocker_id")
    .in("blocker_id", [userId, otherId])
    .in("blocked_id", [userId, otherId])
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * True when the member has a block with ANY of the candidates.
 *
 * Used by write paths where the counterparties are already known (the post's
 * author and the parent comment's author), so one query covers the row.
 */
export async function isBlockedWithAny(
  db: ServiceClient,
  userId: string,
  otherIds: Array<string | null | undefined>,
): Promise<boolean> {
  const ids = [...new Set(otherIds.filter((id): id is string => Boolean(id) && id !== userId))];
  if (ids.length === 0) return false;
  // Delegate to the peer mapping: the raw query can also return a block
  // between two candidates that does not involve this member (A blocked B
  // while the member comments on A's thread and replies to B). Only rows that
  // actually name the member count.
  const blocked = await blockedAmong(db, userId, ids);
  return blocked.size > 0;
}

/** The subset of candidates that have a block with the member, either way. */
export async function blockedAmong(
  db: ServiceClient,
  userId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(candidateIds.filter((id) => id !== userId))];
  if (ids.length === 0) return new Set();
  const { data } = await blocksTable(db)
    .select("blocker_id, blocked_id")
    .in("blocker_id", [userId, ...ids])
    .in("blocked_id", [userId, ...ids]);

  return blockedPeerIds(
    (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>,
    userId,
  );
}

export interface BlockedMember {
  id: string;
  name: string;
  avatar_url: string | null;
  blocked_at: string;
}

/** Everyone the member has blocked, newest first, with name + avatar. */
export async function listBlockedMembers(
  db: ServiceClient,
  userId: string,
): Promise<BlockedMember[]> {
  const { data: rows } = await blocksTable(db)
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  const blockRows = (rows ?? []) as Array<{ blocked_id: string; created_at: string }>;
  if (blockRows.length === 0) return [];

  const ids = blockRows.map((row) => row.blocked_id);
  const { data: users } = await db
    .from("users")
    .select("id, name")
    .in("id", ids);
  const { data: profiles } = await db
    .from("designer_profiles")
    .select("user_id, avatar_url")
    .in("user_id", ids);

  const names = new Map((users ?? []).map((user) => [user.id, user.name]));
  const avatars = new Map(
    (profiles ?? []).map((profile) => [profile.user_id, profile.avatar_url ?? null]),
  );

  return blockRows.map((row) => ({
    id: row.blocked_id,
    name: names.get(row.blocked_id) ?? "Member",
    avatar_url: avatars.get(row.blocked_id) ?? null,
    blocked_at: row.created_at,
  }));
}

/** Insert a block. Idempotent — blocking twice is not an error. */
export async function blockMember(
  db: ServiceClient,
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  const { error } = await blocksTable(db).upsert(
    { blocker_id: blockerId, blocked_id: blockedId },
    { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
  );
  return !error;
}

/** Remove a block. Idempotent. */
export async function unblockMember(
  db: ServiceClient,
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  const { error } = await blocksTable(db)
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  return !error;
}
