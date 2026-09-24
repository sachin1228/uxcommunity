import type { CachedSidebarCommunity } from "@/lib/communities/cache";

type Community = Pick<
  CachedSidebarCommunity,
  "last_message" | "last_content" | "joined_at" | "name" | "pinned_until"
>;

/**
 * An event's group chat rides at the top of the sidebar until its event date.
 *
 * Presence is the whole test: the server sends `pinned_until` only while the
 * event is still ahead, so nothing here has to compare against a clock (a
 * comparator that reads time is neither pure nor stable inside a sort). The
 * pin expires on the next sidebar fetch once the event has passed.
 */
export function isPinned(community: Pick<Community, "pinned_until">): boolean {
  return Boolean(community.pinned_until);
}

/**
 * The single sidebar ordering: pinned event chats first (newest membership
 * first among them, so creating an event or RSVP-ing to one puts that room at
 * the very top), then most recent activity, where activity is the newest of
 * (last message, last content item, join date). A freshly joined or created
 * community always floats to the top regardless of how old its last message
 * is, and a brand-new thread/showcase/resource/event raises a community up the
 * list exactly like a message does. Ties fall back to the community name.
 *
 * This is THE canonical order — the realtime top-N selection (which keeps the
 * most recently active communities' sockets alive), the panel sort,
 * and the GlobalSidebar sort must all agree, or a community can be "live" in
 * one list and positioned differently in another.
 */
export function compareByRecentActivity(a: Community, b: Community): number {
  const aPinned = isPinned(a);
  const bPinned = isPinned(b);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  if (aPinned && bPinned) {
    const aJoined = a.joined_at ?? "";
    const bJoined = b.joined_at ?? "";
    if (aJoined !== bJoined) return bJoined > aJoined ? 1 : -1;
  }

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
