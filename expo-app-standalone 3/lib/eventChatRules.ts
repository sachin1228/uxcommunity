/**
 * The name an event's group chat is born with — the renderable half of the
 * web app's `lib/communities/event-chat-rules.ts`. The room itself is created
 * server-side; the mobile card only has to call it the same thing the sidebar
 * will.
 */

/** Community names are capped the same way the Create Community form caps them. */
export const EVENT_CHAT_NAME_MAX = 80;

/**
 * The room's name: the event's title, trimmed and capped. A title that trims
 * away to nothing still needs a name, so it falls back to a generic one — the
 * room is never nameless in the sidebar.
 */
export function eventChatName(title: string): string {
  return title.trim().slice(0, EVENT_CHAT_NAME_MAX) || 'Event chat';
}
