import type { CachedMessage } from "@/lib/communities/cache";
import { appendMessage, markFailed, mergeConfirmedGif, updateMessages } from "./message-list";
import { postMessage } from "./network";
import { buildOptimisticMessage, bumpSidebarPreview, scrollToNewest } from "./optimistic";
import type { SendContext } from "./types";

/**
 * Send a GIF or sticker directly from an external URL (GIPHY).
 * No file upload needed — the URL is stored as image_url directly.
 */
export async function runGifSend(ctx: SendContext, gifUrl: string, tempId: string): Promise<void> {
  const { communityId, setMessages } = ctx;
  const update = (fn: (prev: CachedMessage[]) => CachedMessage[]) =>
    updateMessages(setMessages, communityId, fn);

  const optimistic = buildOptimisticMessage(ctx, {
    tempId,
    content: "",
    replyTo: null,
    imageUrl: gifUrl,
    mentions: [],
  });
  update(appendMessage(optimistic));

  // Same instant sidebar bump as text/image sends.
  const rollbackSidebar = bumpSidebarPreview(communityId, {
    id: tempId,
    content: "",
    created_at: optimistic.created_at,
    user: { name: ctx.currentUserName },
    is_own: true,
    has_image: true,
    is_reply: false,
    reply_to_user: null,
    is_deleted: false,
    reactions: [],
  });
  scrollToNewest(ctx);

  // Tracked like every other send, so cancelling this bubble aborts this
  // request — not whichever send happened to start last.
  const abortController = new AbortController();
  ctx.abortControllers.set(tempId, abortController);

  try {
    // Same per-send nonce as text/image sends: posting the same GIF twice
    // in a row must produce two messages, not one deduped request.
    const res = await postMessage(
      communityId,
      { content: "", image_url: gifUrl, mentions: [], client_nonce: tempId },
      abortController.signal,
    );

    const data = await res.json().catch(() => ({}));

    if (res.status === 201) {
      ctx.setHideUnreadDivider(true);
      const message = data.message;
      if (!message) throw new Error("No message in response");
      update((prev) => mergeConfirmedGif(prev, tempId, message));
    } else {
      update(markFailed(tempId));
      rollbackSidebar();
      ctx.setError((data as { error?: string }).error ?? "Failed to send.");
    }
  } catch (err) {
    // A cancelled GIF send already removed its bubble (and has no retry
    // payload), so only a real failure marks the row failed.
    if ((err as Error).name !== "AbortError") {
      update(markFailed(tempId));
      ctx.setError("Network error.");
    }
    rollbackSidebar();
  } finally {
    ctx.abortControllers.delete(tempId);
  }
}
