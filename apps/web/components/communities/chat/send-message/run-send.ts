import type { CachedMessage } from "@/lib/communities/cache";
import { preloadImage } from "@/lib/image-client";
import {
  appendMessage,
  markFailed,
  mergeConfirmedMessage,
  removeMessage,
  updateMessages,
} from "./message-list";
import { postMessage, uploadMessageImage } from "./network";
import { buildOptimisticMessage, bumpSidebarPreview, scrollToNewest } from "./optimistic";
import type { SendArgs, SendContext, SendResult } from "./types";

/**
 * Core send logic for text/image messages, shared by the composer and retry.
 *
 * Everything before the first `await` (optimistic bubble, sidebar bump,
 * scroll pin) runs synchronously, which the hook's same-tick re-entry guard
 * relies on.
 */
export async function runSend(
  ctx: SendContext,
  { content, imageFile, imagePreviewUrl, replyTo, tempId }: SendArgs,
): Promise<SendResult> {
  const { communityId, setMessages } = ctx;
  const update = (fn: (prev: CachedMessage[]) => CachedMessage[]) =>
    updateMessages(setMessages, communityId, fn);

  // Set when the POST confirms the message landed — used by the caller to
  // re-commit the row if the user switched communities mid-upload.
  let lastConfirmedMessage: CachedMessage | null = null;
  // Persist retry data before any async work
  ctx.failedRetryData.set(tempId, { file: imageFile, content, replyTo });

  const mentions = ctx.resolveMentionsFor(content);
  const optimistic = buildOptimisticMessage(ctx, {
    tempId,
    content,
    replyTo,
    imageUrl: imagePreviewUrl,
    mentions,
  });
  update(appendMessage(optimistic));

  const rollbackSidebar = bumpSidebarPreview(communityId, {
    id: tempId,
    content,
    created_at: optimistic.created_at,
    user: { name: ctx.currentUserName },
    is_own: true,
    has_image: !!imagePreviewUrl && !content,
    is_reply: !!replyTo,
    // A reply anchored to a "created a …" card names the kind, not a person.
    reply_to_user: replyTo && !replyTo.content_kind ? replyTo.user_name.split(" ")[0] : null,
    reply_to_content_kind: replyTo?.content_kind ?? null,
    is_deleted: false,
    reactions: [],
  });
  scrollToNewest(ctx);

  const abortController = new AbortController();
  ctx.abortControllers.set(tempId, abortController);
  const sentCommunityId = communityId;

  try {
    const uploadedImageUrl = imageFile
      ? await uploadMessageImage(communityId, imageFile, abortController.signal)
      : null;

    // Warm the browser cache for the uploaded image while the message POST is
    // in flight. The optimistic bubble is showing the local blob URL — swapping
    // the <img> src to the network URL before it has loaded collapses the
    // bubble into a blank frame for a split second. Preloading (and awaiting it
    // before the merge below) makes the blob → network transition seamless.
    const imagePreload = uploadedImageUrl ? preloadImage(uploadedImageUrl) : null;

    const res = await postMessage(
      communityId,
      {
        content,
        // Message replies and content replies are mutually exclusive: a
        // content reply's id is a thread/showcase/resource/event id, not a
        // message id — sending it as reply_to_id would make the API try
        // (and fail) to validate it as a message and drop the anchor.
        reply_to_id: replyTo?.content_kind ? null : replyTo?.id ?? null,
        // Replies anchored to a content item (a "created a …" card) ride
        // alongside; the API ignores it when reply_to_id is set.
        reply_to_content: replyTo?.content_kind
          ? { id: replyTo.id, kind: replyTo.content_kind }
          : null,
        image_url: uploadedImageUrl,
        mentions: mentions.map((m) => ({ user_id: m.user_id })),
        client_nonce: tempId,
      },
      abortController.signal,
    );

    const data = await res.json().catch(() => ({}));

    if (res.status === 201) {
      ctx.setHideUnreadDivider(true);
      const message = data.message;
      if (!message) {
        throw new Error("Server returned success without a message.");
      }

      // Ensure the uploaded image is decoded before swapping it into the
      // message, so the blob → network URL transition never flashes an empty
      // bubble. (Preload resolves on failure too, so this can't hang.)
      if (imagePreload) await imagePreload;

      update((prev) => {
        const { next, merged } = mergeConfirmedMessage(prev, tempId, message);
        lastConfirmedMessage = merged;
        return next;
      });
      // Sent successfully — clear retry data
      ctx.failedRetryData.delete(tempId);
    } else {
      update(markFailed(tempId));
      rollbackSidebar();
      ctx.setError(data.error ?? "Failed to send.");
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      if (ctx.failedRetryData.get(tempId)?.file) {
        // Image upload was cancelled — keep bubble in "failed" state for retry
        update(markFailed(tempId));
      } else {
        // Text-only cancel — remove the optimistic message
        update(removeMessage(tempId));
        ctx.failedRetryData.delete(tempId);
      }
      rollbackSidebar();
      // Abort before confirmation: nothing was sent, report nothing.
      return { sentCommunityId: null, message: null };
    }

    update(markFailed(tempId));
    rollbackSidebar();
    ctx.setError(err instanceof Error ? err.message : "Network error.");
  } finally {
    ctx.abortControllers.delete(tempId);
    // Revoke the blob URL now that upload is done (success, fail, or cancel)
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  }

  // Success commit — make it resilient to a community switch mid-upload:
  // the state updater above is bound to the community the user navigated
  // AWAY from, so capture the result and commit it to whichever community
  // is mounted now if that changed.
  return { sentCommunityId, message: lastConfirmedMessage };
}
