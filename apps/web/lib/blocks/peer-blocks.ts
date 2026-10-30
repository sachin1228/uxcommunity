/**
 * Pure half of the block lookups: from block rows that mention the member,
 * which peers are on the other side of a block?
 *
 * A row can name the member as the blocker or the blocked member; both mean
 * the pair must not interact. Kept separate from the Supabase client so the
 * set logic is unit-tested without a database.
 */

export interface BlockRow {
  blocker_id: string;
  blocked_id: string;
}

export function blockedPeerIds(
  rows: readonly BlockRow[],
  userId: string,
): Set<string> {
  const peers = new Set<string>();
  for (const row of rows) {
    if (row.blocker_id === userId) peers.add(row.blocked_id);
    else if (row.blocked_id === userId) peers.add(row.blocker_id);
  }
  peers.delete(userId);
  return peers;
}
