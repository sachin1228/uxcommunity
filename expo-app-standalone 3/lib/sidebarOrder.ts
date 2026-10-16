/**
 * The communities list's ordering, ported from the web sidebar's
 * `sidebar-order.ts` (minus `last_content`, which the mobile list does not
 * carry yet).
 *
 * An event's group chat rides at the top of the list until its event date.
 * Presence is the whole test, and stays that way: the server sends
 * `pinned_until` only while the event is still ahead, and the one deadline the
 * client is still holding when it passes is cleared out of state (see
 * expiredPinIds and useCommunities) rather than compared here. A comparator
 * that reads the clock is neither pure nor stable inside a sort.
 */

import type { Community } from './communities';

type Orderable = Pick<Community, 'id' | 'name' | 'joined_at' | 'last_message' | 'pinned_until'>;

export function isPinned(community: Pick<Community, 'pinned_until'>): boolean {
  return Boolean(community.pinned_until);
}

/**
 * The rows whose pin deadline has passed, by id — the clock is the caller's,
 * so this stays a pure question about the data.
 *
 * `pinned_until` is the event's end, and the server only sends it while it is
 * ahead — but a client that was handed the value keeps it until its next
 * fetch, which would leave a room pinned above communities that talk more (and
 * wearing a pin mark) for as long as that fetch takes to land. The list
 * expires the deadline itself, on its own clock, and clears the ids it hands
 * back. Unreadable values are not expired: bad data must not cost a row its
 * pin.
 */
export function expiredPinIds(
  communities: ReadonlyArray<Pick<Community, 'id' | 'pinned_until'>>,
  nowMs: number,
): string[] {
  return communities
    .filter((community) => {
      const deadline = community.pinned_until ? Date.parse(community.pinned_until) : Number.NaN;
      return Number.isFinite(deadline) && deadline <= nowMs;
    })
    .map((community) => community.id);
}

/** The newest of the row's own activity instants. */
function activityAt(community: Orderable): string {
  const times = [community.last_message?.created_at ?? '', community.joined_at ?? ''].sort();
  return times[times.length - 1] ?? '';
}

/**
 * The single list ordering: pinned event chats first (newest membership first
 * among them, so creating an event or RSVP-ing to one puts that room at the
 * very top), then most recent activity, where activity is the newest of (last
 * message, join date). A freshly joined or created community floats to the
 * top regardless of how old its last message is. Ties fall back to the name —
 * the same canonical order as the web sidebar, so both clients show the same
 * list in the same sequence.
 */
export function compareByRecentActivity(a: Orderable, b: Orderable): number {
  const aPinned = isPinned(a);
  const bPinned = isPinned(b);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  if (aPinned && bPinned) {
    const aJoined = a.joined_at ?? '';
    const bJoined = b.joined_at ?? '';
    if (aJoined !== bJoined) return bJoined > aJoined ? 1 : -1;
  }

  const ta = activityAt(a);
  const tb = activityAt(b);
  if (tb > ta) return 1;
  if (ta > tb) return -1;
  return a.name.localeCompare(b.name);
}

/** A sorted copy of the list — never sorts the caller's array in place. */
export function sortByLastActivity<T extends Orderable>(list: readonly T[]): T[] {
  return [...list].sort(compareByRecentActivity);
}

/**
 * Move one community to position 0 on a new message (WhatsApp UX) — except
 * that pinned event rooms keep riding above: a message in an ordinary
 * community lands it right under the pinned block, and a message in a pinned
 * room takes the very top, exactly where the web comparator would put it.
 */
export function bubbleToTop<T extends Orderable>(list: readonly T[], communityId: string): T[] {
  const idx = list.findIndex((c) => c.id === communityId);
  if (idx < 0) return [...list];
  const moved = list[idx];
  const rest = [...list.slice(0, idx), ...list.slice(idx + 1)];
  if (isPinned(moved)) return [moved, ...rest];

  const pinned: T[] = [];
  const others: T[] = [];
  for (const c of rest) (isPinned(c) ? pinned : others).push(c);
  return [...pinned, moved, ...others];
}
