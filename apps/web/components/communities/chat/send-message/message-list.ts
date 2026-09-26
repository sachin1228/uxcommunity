import { msgCache, type CachedMessage } from "@/lib/communities/cache";
import type { SetMessages } from "./types";

type Message = CachedMessage;

/** Apply a list update to React state and mirror the result into the message cache. */
export function updateMessages(
  setMessages: SetMessages,
  communityId: string,
  update: (prev: Message[]) => Message[],
): void {
  setMessages((prev) => {
    const next = update(prev);
    msgCache.set(communityId, next);
    return next;
  });
}

export const markFailed = (tempId: string) => (prev: Message[]): Message[] =>
  prev.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m));

export const removeMessage = (id: string) => (prev: Message[]): Message[] =>
  prev.filter((m) => m.id !== id);

export const appendMessage = (message: Message) => (prev: Message[]): Message[] =>
  [...prev, message];

export function sortByCreatedAt(list: Message[]): Message[] {
  return list.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

/**
 * Swap the optimistic bubble for the server's confirmed row.
 *
 * The server returns a bare insert (users: null, reply_to: null) to avoid
 * expensive post-insert DB fetches. Merge it over the optimistic message so we
 * preserve the sender's name/avatar and reply preview that the client already
 * had. When Realtime beat the API response, the real entry already carries
 * those fields (and the blob URL) — merge on top of it instead of the removed
 * optimistic bubble.
 */
export function mergeConfirmedMessage(
  prev: Message[],
  tempId: string,
  message: Message,
): { next: Message[]; merged: Message } {
  const optimistic = prev.find((m) => m.id === tempId);
  const existing   = prev.find((m) => m.id === message.id);

  const merged: Message = {
    ...(existing ?? optimistic ?? {}),
    ...message,
    users:     message.users    ?? existing?.users    ?? optimistic?.users    ?? null,
    reply_to:  message.reply_to ?? existing?.reply_to ?? optimistic?.reply_to ?? null,
    image_url: message.image_url ?? existing?.image_url ?? optimistic?.image_url ?? null,
    status: "sent" as const,
  };

  if (existing) {
    // Realtime beat the API response — update the existing real entry.
    // The optimistic bubble may ALREADY be gone: the echo of an earlier
    // send used to remove every temp- row by this user, which turned
    // this map into a no-op and left the message missing. Append
    // defensively when both the temp and the real row are absent.
    const withoutTemp = prev.filter((m) => m.id !== tempId);
    const next = withoutTemp.some((m) => m.id === message.id)
      ? withoutTemp.map((m) => (m.id === message.id ? merged : m))
      : sortByCreatedAt([...withoutTemp, merged]);
    return { next, merged };
  }

  const next = prev.map((m) => (m.id === tempId ? merged : m));
  if (!next.some((m) => m.id === message.id)) {
    // Same defensive append for the no-echo path: if the optimistic
    // bubble was removed elsewhere, add the confirmed message back
    // instead of silently dropping it.
    return { next: sortByCreatedAt([...next.filter((m) => m.id !== tempId), merged]), merged };
  }
  return { next, merged };
}

/** GIF variant: no reply preview to preserve, and no defensive re-append. */
export function mergeConfirmedGif(prev: Message[], tempId: string, message: Message): Message[] {
  const optimistic = prev.find((m) => m.id === tempId);
  const merged: Message = {
    ...(optimistic ?? {}),
    ...message,
    users:     message.users    ?? optimistic?.users    ?? null,
    reply_to:  message.reply_to ?? optimistic?.reply_to ?? null,
    image_url: message.image_url ?? optimistic?.image_url ?? null,
    status: "sent" as const,
  };

  if (prev.some((m) => m.id === message.id)) {
    return prev
      .filter((m) => m.id !== tempId)
      .map((m) => (m.id === message.id ? merged : m));
  }
  return prev.map((m) => (m.id === tempId ? merged : m));
}

/**
 * Commit a confirmed row straight into another community's cache — used when
 * the user navigated away mid-send, so the state updater never reached the UI.
 */
export function commitToCommunityCache(communityId: string, tempId: string, confirmed: Message): void {
  const cached = msgCache.get(communityId) ?? [];
  if (cached.some((m) => m.id === confirmed.id)) return;
  const withoutTemp = cached.filter((m) => m.id !== tempId);
  msgCache.set(communityId, sortByCreatedAt([...withoutTemp, confirmed]));
}
