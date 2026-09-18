import { createServiceClient } from "@/lib/supabase/service";

/**
 * Total unread chat messages per member.
 *
 * Wraps the `get_unread_message_totals` SQL function, which mirrors the unread
 * definition `get_community_sidebar_activity` uses — so the number the icon
 * badge shows is the same number the app shows.
 *
 * The generated Supabase types do not know this function yet, and the client's
 * `rpc` overload then collapses its argument to `undefined`. The cast is
 * local to this module so no caller has to repeat it (see
 * lib/supabase/performance-rpcs.ts for the same pattern).
 */
interface UntypedRpc {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

/** One row per requested member; members with no memberships are absent. */
export async function loadUnreadMessageTotals(
  userIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (userIds.length === 0) return totals;

  try {
    const db = createServiceClient() as unknown as UntypedRpc;
    const { data } = await db.rpc("get_unread_message_totals", { p_user_ids: userIds });

    for (const row of (data ?? []) as { user_id: string; unread: number }[]) {
      totals.set(row.user_id, Number(row.unread) || 0);
    }
  } catch (error) {
    // A badge is a convenience; never let it break the caller.
    console.error("[push] unread totals failed", error);
  }

  return totals;
}
