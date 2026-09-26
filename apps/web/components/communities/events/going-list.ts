import type { EventRsvp } from "@/lib/communities/models/events";

/**
 * The info card's "who is going" list: RSVP rows in, named entries out.
 *
 * Two decisions live here rather than in the component because both are easy to
 * get subtly wrong and hard to notice: who the reader is in the list, and how
 * many people are left over once it is cut to fit. They are pure, so they are
 * unit tested.
 */

export interface GoingEntry {
  user_id: string;
  /**
   * The member's actual name. The avatar falls back to its initials and its
   * colour, so this stays the real name even on the reader's own row — only the
   * printed label becomes "You".
   */
  name: string;
  /** What the card prints for this row. */
  label: string;
  avatar_url: string | null;
  is_self: boolean;
}

export function toGoingEntries(
  going: EventRsvp[],
  currentUserId: string,
): GoingEntry[] {
  return going.map((rsvp) => {
    const isSelf = rsvp.user_id === currentUserId;
    // A profile that has never been filled in still counts as somebody: the
    // list is about who is coming, not about who has an avatar.
    const name = rsvp.users?.name ?? "Someone";
    return {
      user_id: rsvp.user_id,
      name,
      label: isSelf ? "You" : name,
      avatar_url: rsvp.users?.avatar_url ?? null,
      is_self: isSelf,
    };
  });
}

/**
 * The rows the card shows, plus how many people are beyond them.
 *
 * `total` is the authoritative going count and it can exceed the rows in hand:
 * the payload is a bounded preview, so the remainder has to be counted from the
 * true total rather than from the slice — otherwise a full event would report
 * "+18 more" for the ninety-four people it is not showing.
 */
export function goingPreview(
  entries: GoingEntry[],
  limit: number,
  total: number = entries.length,
): { visible: GoingEntry[]; more: number } {
  const visible = limit > 0 ? entries.slice(0, limit) : [];
  return { visible, more: Math.max(0, total - visible.length) };
}
