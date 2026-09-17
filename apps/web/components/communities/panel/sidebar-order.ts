import type { CachedSidebarCommunity } from "@/lib/communities/cache";

type Community = Pick<
  CachedSidebarCommunity,
  "last_message" | "last_content" | "joined_at" | "name"
>;

/**
 * The single sidebar ordering: most recent activity first, where activity is
 * the newest of (last message, last content item, join date). A freshly joined
 * or created community always floats to the top regardless of how old its last
 * message is, and a brand-new thread/showcase/resource/event raises a
 * community up the list exactly like a message does. Ties fall back to the
 * community name.
 *
 * This is THE canonical order — the realtime top-N selection (which keeps the
 * most recently active communities' sockets alive), the panel sort,
 * and the GlobalSidebar sort must all agree, or a community can be "live" in
 * one list and positioned differently in another.
 */
export function compareByRecentActivity(a: Community, b: Community): number {
  const ta = [
    a.last_message?.created_at,
    a.last_content?.created_at,
    a.joined_at,
  ].filter(Boolean).sort().at(-1) ?? "";
  const tb = [
    b.last_message?.created_at,
    b.last_content?.created_at,
    b.joined_at,
  ].filter(Boolean).sort().at(-1) ?? "";
  if (tb > ta) return 1;
  if (ta > tb) return -1;
  return a.name.localeCompare(b.name);
}
