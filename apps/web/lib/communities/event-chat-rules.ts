/**
 * Pure rules behind an event's group chat (see lib/communities/event-chat).
 *
 * The database-facing half of that module can only be exercised against a
 * database; these two decisions are the ones a regression would most likely
 * break (a room named past the cap, or a door that opens for the wrong
 * member), so they live here as plain functions and are unit tested.
 */

/**
 * `communities.type` of an event's group chat. Rooms are created with a chat
 * room's areas (see lib/communities/event-chat), which is what keeps Showcase
 * — its own flag, defaulting to on — out of a brand-new event room until the
 * owner switches it on there.
 */
export const EVENT_CHAT_COMMUNITY_TYPE = "event";

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
 * The description every event room is born with. "Group chat for this event"
 * is what the room wears until its owner says otherwise, and the offer to
 * keep the room reads it as one of the three event clothes a room can still
 * be in (see roomStillWearsEvent).
 */
export const EVENT_CHAT_DESCRIPTION =
  "Group chat for this event — say hi to everyone going.";

/**
 * Whether a room still wears all three of the event's clothes — the name, the
 * face and the description the event gave it at creation. The owner's offer
 * to keep the room retires the moment any of the three stops matching: one
 * personal edit means the room is being made its own and the offer has done
 * its job. The event's own edits stop following such a room too (see
 * syncEventChatCommunity), so the two must agree on exactly this test. A
 * cleared description counts as the event's own — nobody wrote one, which is
 * not a description of the room's own.
 */
export function roomStillWearsEvent(
  room: { name: string | null; image_url: string | null; description: string | null },
  event: { title: string; cover_image_url: string | null },
): boolean {
  return (
    room.name === eventChatName(event.title) &&
    (room.image_url ?? null) === (event.cover_image_url ?? null) &&
    (room.description ?? EVENT_CHAT_DESCRIPTION) === EVENT_CHAT_DESCRIPTION
  );
}

/**
 * Whether the room is still only a chat — no area of its own switched on. A
 * room born from an event carries `["chat"]` alone, with Showcase off (see
 * ensureEventChatCommunity); the owner switching on any other area — threads,
 * showcase, resources, events — is the room being carried on as a community,
 * and the offer has done its job. A row that never carried the tabs, or the
 * showcase flag, reads as untouched: absence is not an edit.
 */
export function roomStillOnlyChat(
  tabs: string[] | null | undefined,
  showcaseEnabled: boolean | null | undefined,
): boolean {
  return (
    (tabs ?? ["chat"]).every((tab) => tab === "chat") &&
    showcaseEnabled !== true
  );
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
