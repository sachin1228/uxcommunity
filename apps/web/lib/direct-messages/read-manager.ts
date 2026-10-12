/**
 * Read-marker management for the DM thread.
 *
 * One PATCH per conversation per cooldown window, however many times the
 * caller asks — opening a thread, receiving live messages while it is open
 * and tab-visibility returns all funnel through `markConversationRead`.
 * Mirrors the community chat's mark-read posture (debounce + cooldown +
 * listener broadcast) without its sidebar coupling.
 */

const RETRY_DELAY_MS = 2_000;
const COOLDOWN_MS = 20_000;
const DEBOUNCE_MS = 500;

let activeConversationId: string | null = null;

const lastMarkedAt = new Map<string, number>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

/** Called by the thread view when it opens/closes a conversation. */
export function setActiveConversation(conversationId: string | null): void {
  const previous = activeConversationId;
  activeConversationId = conversationId;
  if (conversationId && conversationId !== previous) {
    // Opening a thread marks it read immediately (the first read of a visit
    // bypasses the cooldown — it is what clears the unread badge).
    markConversationRead(conversationId, { immediate: true });
  }
}

async function sendRead(conversationId: string, attempt = 0): Promise<void> {
  const markedAt = new Date().toISOString();
  try {
    const res = await fetch(`/api/dm/conversations/${conversationId}/read`, {
      method: "PATCH",
    });
    if (!res.ok) throw new Error(`read failed: ${res.status}`);
    lastMarkedAt.set(conversationId, Date.now());
    for (const listener of listeners) listener(conversationId, markedAt);
  } catch {
    // One bounded retry — a blip must not leave the badge stuck on a
    // conversation the member is demonstrably reading.
    if (attempt === 0) setTimeout(() => void sendRead(conversationId, 1), RETRY_DELAY_MS);
  }
}

/**
 * Ask to mark a conversation read. `immediate` skips the debounce (thread
 * open); every other caller is debounced and then rate-limited by the
 * cooldown so live messages cannot turn into one PATCH per message.
 */
export function markConversationRead(
  conversationId: string,
  options: { immediate?: boolean } = {},
): void {
  const marked = lastMarkedAt.get(conversationId);
  if (!options.immediate && marked !== undefined && Date.now() - marked < COOLDOWN_MS) {
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
