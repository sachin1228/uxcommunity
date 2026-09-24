/**
 * Pure rules behind an event's group chat (see lib/communities/event-chat).
 *
 * The database-facing half of that module can only be exercised against a
 * database; these two decisions are the ones a regression would most likely
 * break (a room named past the cap, or a door that opens for the wrong
 * member), so they live here as plain functions and are unit tested.
 */

/** Community names are capped the same way the Create Community form caps them. */
export const EVENT_CHAT_NAME_MAX = 80;

/**
 * The room's name: the event's title, trimmed and capped. A title that trims
 * away to nothing still needs a name, so it falls back to a generic one — the
 * room is never nameless in the sidebar.
 */
export function eventChatName(title: string): string {
  return title.trim().slice(0, EVENT_CHAT_NAME_MAX) || "Event chat";
}

/**
 * Who may join the room: everybody when the event is public, and otherwise only
 * the members of the community the event was created in. An event with no
 * community and no public flag is visible to nobody, so it stays closed.
 */
export function canJoinEventChatWith(
  isPublic: boolean,
  isParentCommunityMember: boolean,
): boolean {
  return isPublic || isParentCommunityMember;
}
