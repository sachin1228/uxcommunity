import { createServiceClient } from "@/lib/supabase/service";

/**
 * Total unread chat messages per member.
 *
 * Wraps the `get_unread_message_totals` SQL function, which mirrors the unread
 * definition `get_sidebar_activity` uses — so the number the icon badge shows
 * is the same number the app shows.
 *
 * The generated Supabase types do not know this function yet, and the client's
 * `rpc` overload then collapses its argument to `undefined`. The cast is
 * local to this module so no caller has to repeat it (see
 * lib/supabase/performance-rpcs.ts for the same pattern).
 */
export interface UntypedRpc {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

/**
 * Members per RPC call.
 *
 * The function aggregates one community scan per membership, so its cost grows
 * with the array it is handed: a message to a 50,000-member community used to
 * ask for every badge in a single call. Chunking bounds both the work per call
 * and the response size, while the caller's map is built up across calls
 * exactly as if it had been one.
 */
export const UNREAD_TOTALS_CHUNK = 300;

/**
 * One row per requested member; members with no memberships are absent.
 *
 * `db` is injectable so the push sender can reuse the client it already holds
 * (and so the batching can be tested against a fake without credentials).
 */
export async function loadUnreadMessageTotals(
  userIds: string[],
  db: UntypedRpc = createServiceClient() as unknown as UntypedRpc,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (userIds.length === 0) return totals;

  // Dedupe first: a caller that reaches the same member from two sources (for
  // example a token holder counted twice) must not pay for them twice.
  const unique = [...new Set(userIds)];

  try {
    for (let i = 0; i < unique.length; i += UNREAD_TOTALS_CHUNK) {
      const chunk = unique.slice(i, i + UNREAD_TOTALS_CHUNK);
      const { data } = await db.rpc("get_unread_message_totals", { p_user_ids: chunk });

      for (const row of (data ?? []) as { user_id: string; unread: number }[]) {
        totals.set(row.user_id, Number(row.unread) || 0);
      }
    }
  } catch (error) {
    // A badge is a convenience; never let it break the caller.
    console.error("[push] unread totals failed", error);
  }

  return totals;
}
