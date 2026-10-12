/**
 * DM API surface used by client components — one place for every URL and the
 * few fire-and-forget calls (typing).
 */

export const dmUrls = {
  conversations: "/api/dm/conversations",
  conversationMessages: (conversationId: string) =>
    `/api/dm/conversations/${conversationId}/messages`,
  conversationRead: (conversationId: string) =>
    `/api/dm/conversations/${conversationId}/read`,
  conversationTyping: (conversationId: string) =>
    `/api/dm/conversations/${conversationId}/typing`,
  conversationUpload: (conversationId: string) =>
    `/api/dm/conversations/${conversationId}/upload`,
  message: (messageId: string) => `/api/dm/messages/${messageId}`,
  messageReactions: (messageId: string) =>
    `/api/dm/messages/${messageId}/reactions`,
  unread: "/api/dm/unread",
} as const;

/**
 * Tell the peer the viewer is typing. Server relays it to both participants'
 * DM rooms; failures are ignored (a lost typing pulse is invisible in
 * aggregate — the next one arrives a keystroke later).
 */
export function sendDmTypingPulse(conversationId: string, typing: boolean): void {
  void fetch(dmUrls.conversationTyping(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ typing }),
  }).catch(() => {});
}
