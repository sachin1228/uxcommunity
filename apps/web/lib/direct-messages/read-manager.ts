/**
 * Read-marker management for the DM thread.
 *
 * One PATCH per conversation per cooldown window, however many times the
 * caller asks — opening a thread, receiving live messages while it is open
 * and tab-visibility returns all funnel through `markConversationRead`.
 *
 * Two rules distinguish this from "PATCH now() on open":
 *
 *   * The marker is the timestamp of the newest message the client has
 *     actually DISPLAYED (`lastReadAt`), so a message that arrived between
 *     render and request can never be silently marked read.
 *   * Requests coalesce to the newest timestamp seen (never send an older
 *     position over a newer one), and the server stores
 *     greatest(existing, incoming) — so stale tabs, retries and a second
 *     device cannot move the marker backwards.
 *
 * Mirrors the community chat's debounce + cooldown + listener posture
 * without its sidebar coupling.
 */

const RETRY_DELAY_MS = 2_000;
const COOLDOWN_MS = 20_000;
const DEBOUNCE_MS = 500;

let activeConversationId: string | null = null;

const lastMarkedAt = new Map<string, number>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Newest displayed-message timestamp awaiting a request, per conversation. */
const pendingLastReadAt = new Map<string, string>();
const listeners = new Set<(conversationId: string, markedAt: string) => void>();

/** Is the viewer looking at this conversation right now (tab visible)? */
export function isActivelyReading(conversationId: string): boolean {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return false;
  }
  return activeConversationId === conversationId;
}

export function onConversationRead(
  listener: (conversationId: string, markedAt: string) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Called by the thread view when it opens/closes a conversation. Opening no
 * longer marks by itself: the view marks once the messages are actually laid
 * out, with the newest displayed timestamp (see DirectMessagesView).
 */
export function setActiveConversation(conversationId: string | null): void {
  activeConversationId = conversationId;
}

async function sendRead(conversationId: string, attempt = 0): Promise<void> {
  const lastReadAt = pendingLastReadAt.get(conversationId);
  if (!lastReadAt) return;
  try {
    const res = await fetch(`/api/dm/conversations/${conversationId}/read`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ last_read_at: lastReadAt }),
    });
    if (!res.ok) throw new Error(`read failed: ${res.status}`);
    const data = (await res.json().catch(() => null)) as { markedAt?: string } | null;
    lastMarkedAt.set(conversationId, Date.now());
    // Keep a newer queued position; drop this one if nothing superseded it.
    if (pendingLastReadAt.get(conversationId) === lastReadAt) {
      pendingLastReadAt.delete(conversationId);
    }
    // The listener hears the SERVER's effective marker (greatest of stored
    // and sent), so the list's unread state always mirrors the database.
    const markedAt = data?.markedAt ?? lastReadAt;
    for (const listener of listeners) listener(conversationId, markedAt);
  } catch {
    // One bounded retry — a blip must not leave the badge stuck on a
    // conversation the member is demonstrably reading. The pending timestamp
    // is kept, so the retry reports the newest position.
    if (attempt === 0) setTimeout(() => void sendRead(conversationId, 1), RETRY_DELAY_MS);
  }
}

/**
 * Ask to mark a conversation read up to `lastReadAt` (the newest displayed
 * message's timestamp). `immediate` skips the debounce (thread open); every
 * other caller is debounced and then rate-limited by the cooldown so live
 * messages cannot turn into one PATCH per message.
 */
export function markConversationRead(
  conversationId: string,
  options: { immediate?: boolean; lastReadAt?: string } = {},
): void {
  const incoming = options.lastReadAt;
  if (incoming) {
    const pending = pendingLastReadAt.get(conversationId);
    if (!pending || new Date(incoming).getTime() > new Date(pending).getTime()) {
      pendingLastReadAt.set(conversationId, incoming);
    }
  }

  const marked = lastMarkedAt.get(conversationId);
  if (!options.immediate && marked !== undefined && Date.now() - marked < COOLDOWN_MS) {
    // Too soon for another request — but the newest position is now pending,
    // so a quiet thread still settles when the cooldown lapses.
    if (incoming && !pendingTimers.has(conversationId)) {
      const wait = Math.max(0, COOLDOWN_MS - (Date.now() - marked));
      const timer = setTimeout(() => {
        pendingTimers.delete(conversationId);
        void sendRead(conversationId);
      }, wait);
      pendingTimers.set(conversationId, timer);
    }
    return;
  }

  const existing = pendingTimers.get(conversationId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(conversationId);
    void sendRead(conversationId);
  }, options.immediate ? 0 : DEBOUNCE_MS);
  pendingTimers.set(conversationId, timer);
}
