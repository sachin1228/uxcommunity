"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  msgCache,
  patchSidebarLastMessage,
  restoreSidebarEntry,
  sidebarStore,
} from "@/lib/communities/cache";
import type { CachedMessage, MessageMention, ReplyPreview } from "@/lib/communities/cache";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { compressImage, compressedFile, preloadImage } from "@/lib/image-client";

type Message = CachedMessage;

interface UseSendMessageOptions {
  communityId: string;
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setHideUnreadDivider: (val: boolean) => void;
  replyTo: ReplyPreview | null;
  onClearReply: () => void;
  /** Ref to the bottom sentinel — scrolled into view instantly on every send. */
  scrollToBottomRef: React.RefObject<HTMLDivElement>;
  /** Resolves the members @mentioned in the final text (composer registry). */
  resolveMentions?: (content: string) => MessageMention[];
}

type RetryData = {
  file: File | null;
  content: string;
  replyTo: ReplyPreview | null;
};

export function useSendMessage({
  communityId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  setMessages,
  setHideUnreadDivider,
  replyTo,
  onClearReply,
  scrollToBottomRef,
  resolveMentions,
}: UseSendMessageOptions) {
  // Stable-ish helper: mentions only exist while there is text to mention in.
  const mentionResolverRef = useRef(resolveMentions);
  useEffect(() => {
    mentionResolverRef.current = resolveMentions;
  }, [resolveMentions]);
  const resolveMentionsFor = (content: string): MessageMention[] => {
    const trimmed = content.trim();
    return trimmed && mentionResolverRef.current
      ? mentionResolverRef.current(trimmed)
      : [];
  };
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Guards against double-sends: `sending` resets synchronously once the
  // optimistic bubble is shown, so a second Enter while the network request is
  // still in flight would otherwise fire a duplicate POST. This ref stays
  // locked until the request fully settles (success or failure).
  const sendLockRef = useRef(false);

  // Mirror of `sending` kept in a ref so handleRetrySend's guard can read it
  // without depending on the state value (which would recreate the callback on
  // every send and defeat MessageBubble's memoization).
  const sendingRef = useRef(sending);
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  // Stores retry data (file + content + replyTo) keyed by tempId so failed
  // messages can be retried without losing the original payload.
  const failedRetryDataRef = useRef<Map<string, RetryData>>(new Map());

  const replyToRef = useRef<ReplyPreview | null>(replyTo);
  useEffect(() => {
    replyToRef.current = replyTo;
  }, [replyTo]);

  const prevPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevPreviewRef.current && prevPreviewRef.current !== pendingImagePreview) {
      URL.revokeObjectURL(prevPreviewRef.current);
    }

    prevPreviewRef.current = pendingImagePreview;

    return () => {
      if (pendingImagePreview) {
        URL.revokeObjectURL(pendingImagePreview);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [communityId]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;

      const tag = (document.activeElement as HTMLElement)?.tagName;

      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

      inputRef.current?.focus();
    };

    document.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [communityId]);

  const handleImageSelect = useCallback((file: File) => {
    setPendingImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });

    setPendingImageFile(file);
  }, []);

  const handleImageClear = useCallback(() => {
    setPendingImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    setPendingImageFile(null);
  }, []);

  const handleCancelSend = useCallback((tempId: string) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    // For image sends: the AbortError catch in runSend will mark the message
    // as "failed" so the user can retry — don't remove the message here.
    // For text-only sends: no retry data stored, so remove immediately.
    const retryData = failedRetryDataRef.current.get(tempId);
    if (!retryData?.file) {
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== tempId);
        msgCache.set(communityId, next);
        return next;
      });
      failedRetryDataRef.current.delete(tempId);
    }
  }, [communityId, setMessages]);

  /**
   * Core send logic, shared by handleSend and handleRetrySend.
   * Caller is responsible for setting setSending(true) and clearing UI state.
   */
  async function runSend({
    content,
    imageFile,
    imagePreviewUrl,
    replyTo: msgReplyTo,
    tempId,
  }: {
    content: string;
    imageFile: File | null;
    imagePreviewUrl: string | null;
    replyTo: ReplyPreview | null;
    tempId: string;
  }) {
    // Persist retry data before any async work
    failedRetryDataRef.current.set(tempId, {
      file: imageFile,
      content,
      replyTo: msgReplyTo,
    });

    const mentions = resolveMentionsFor(content);

    const optimistic: Message = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: { name: currentUserName, avatar_url: currentUserAvatar },
      status: "sending",
      reactions: [],
      reply_to: msgReplyTo ?? null,
      image_url: imagePreviewUrl,
      mentions,
    };

    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });
    // Bump the community to the top of the sidebar instantly. The chat shows
    // the optimistic bubble already, and the sidebar shouldn't wait for the
    // Realtime echo (DB insert → fan-out → WebSocket round trip) to reflect
    // the sender's own message. The echo replaces this preview when it lands;
    // on failure rollbackSidebar() restores the previous entry.
    const prevSidebarEntry =
      sidebarStore.data?.communities.find((c) => c.id === communityId) ?? null;
    patchSidebarLastMessage(communityId, {
      id: tempId,
      content,
      created_at: optimistic.created_at,
      user: { name: currentUserName },
      is_own: true,
      has_image: !!imagePreviewUrl && !content,
      is_reply: !!msgReplyTo,
      reply_to_user: msgReplyTo ? msgReplyTo.user_name.split(" ")[0] : null,
      is_deleted: false,
      reactions: [],
    });
    const rollbackSidebar = () => {
      if (!prevSidebarEntry) return;
      const current = sidebarStore.data?.communities.find(
        (c) => c.id === communityId
      );
      // Only restore when our optimistic preview is still the newest entry —
      // never clobber a message that arrived after the failed send.
      if (!current || current.last_message?.id !== tempId) return;
      restoreSidebarEntry(communityId, prevSidebarEntry);
    };
    // Immediately jump to the bottom so the user sees their own message,
    // regardless of how far up they were scrolled when they sent it.
    requestAnimationFrame(() => {
      scrollToBottomRef.current?.scrollIntoView({ behavior: "instant" });
    });

    // Re-enable the send button immediately — the optimistic bubble is already
    // visible, so there's no reason to block the input while waiting for the
    // network. Errors are shown inline on the failed bubble.
    setSending(false);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const sendStartedAt = performance.now();
    const clientTimings: Record<string, number> = {};
    const measureClient = async <T,>(name: string, operation: () => Promise<T>) => {
      const startedAt = performance.now();
      try {
        return await operation();
      } finally {
        clientTimings[name] = Math.round((performance.now() - startedAt) * 100) / 100;
      }
    };

    try {
      let uploadedImageUrl: string | null = null;

      if (imageFile) {
        // Compress on the client (canvas → WebP); the upload route stores the
        // bytes as-is since server-side Sharp is unavailable on Workers.
        const fileToSend = await measureClient("client_compression", async () => {
          try {
            return compressedFile(await compressImage(imageFile), imageFile);
          } catch {
            return imageFile;
          }
        });
        const fd = new FormData();
        fd.append("file", fileToSend);

        const uploadRes = await measureClient("image_upload_request", () =>
          fetch(
            `/api/communities/${communityId}/messages/upload`,
            { method: "POST", body: fd, signal: abortController.signal },
          ),
        );

        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error ?? "Image upload failed.");
        }

        const uploadData: unknown = await uploadRes.json().catch(() => null);
        const bodyUrl =
          uploadData &&
          typeof uploadData === "object" &&
          "url" in uploadData &&
          typeof uploadData.url === "string"
            ? uploadData.url.trim()
            : "";
        const headerUrl = uploadRes.headers.get("X-Image-Url")?.trim() ?? "";
        const uploadedUrl = bodyUrl || headerUrl;

        if (!uploadedUrl) {
          throw new Error("Image upload failed: the server returned an invalid response.");
        }

        uploadedImageUrl = uploadedUrl;
      }

      // Warm the browser cache for the uploaded image while the message POST is
      // in flight. The optimistic bubble is showing the local blob URL — swapping
      // the <img> src to the network URL before it has loaded collapses the
      // bubble into a blank frame for a split second. Preloading (and awaiting it
      // before the merge below) makes the blob → network transition seamless.
      const imagePreload = uploadedImageUrl
        ? preloadImage(uploadedImageUrl)
        : null;

      const res = await measureClient("message_create_request", () =>
        dedupeFetch(`/api/communities/${communityId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            reply_to_id: msgReplyTo?.id ?? null,
            image_url: uploadedImageUrl,
            mentions: mentions.map((m) => ({ user_id: m.user_id })),
          }),
          signal: abortController.signal,
        }),
      );

      const data = await res.json().catch(() => ({}));

      if (res.status === 201) {
        setHideUnreadDivider(true);

        const message = data.message;

        if (!message) {
          throw new Error("Server returned success without a message.");
        }

        // Ensure the uploaded image is decoded before swapping it into the
        // message, so the blob → network URL transition never flashes an empty
        // bubble. (Preload resolves on failure too, so this can't hang.)
        if (imagePreload) await imagePreload;

        setMessages((prev) => {
          // The server returns a bare insert (users: null, reply_to: null) to
          // avoid expensive post-insert DB fetches. Merge it over the optimistic
          // message so we preserve the sender's name/avatar and reply preview
          // that the client already had. When Realtime beat the API response,
          // the real entry already carries those fields (and the blob URL) —
          // merge on top of it instead of the removed optimistic bubble.
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
            const next = prev
              .filter((m) => m.id !== tempId)
              .map((m) => m.id === message.id ? merged : m);
            msgCache.set(communityId, next);
            return next;
          }

          const next = prev.map((m) => m.id === tempId ? merged : m);
          msgCache.set(communityId, next);
          return next;
        });

        // Sent successfully — clear retry data
        failedRetryDataRef.current.delete(tempId);
      } else if (res.status === 202) {
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== tempId);
          msgCache.set(communityId, next);
          return next;
        });
        rollbackSidebar();

        setError(data.error ?? "Your message has been sent for moderator review.");
        failedRetryDataRef.current.delete(tempId);
      } else {
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === tempId ? { ...m, status: "failed" as const } : m
          );
          msgCache.set(communityId, next);
          return next;
        });
        rollbackSidebar();

        setError(data.error ?? "Failed to send.");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        const retryData = failedRetryDataRef.current.get(tempId);
        if (retryData?.file) {
          // Image upload was cancelled — keep bubble in "failed" state for retry
          setMessages((prev) => {
            const next = prev.map((m) =>
              m.id === tempId ? { ...m, status: "failed" as const } : m
            );
            msgCache.set(communityId, next);
            return next;
          });
        } else {
          // Text-only cancel — remove the optimistic message
          setMessages((prev) => {
            const next = prev.filter((m) => m.id !== tempId);
            msgCache.set(communityId, next);
            return next;
          });
          failedRetryDataRef.current.delete(tempId);
        }
        rollbackSidebar();
        return;
      }

      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === tempId ? { ...m, status: "failed" as const } : m
        );
        msgCache.set(communityId, next);
        return next;
      });
      rollbackSidebar();
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      abortControllerRef.current = null;
      if (process.env.NODE_ENV === "development") {
        clientTimings.total_send = Math.round((performance.now() - sendStartedAt) * 100) / 100;
        console.debug("[client-timing] community message send", clientTimings);
      }
      // Revoke the blob URL now that upload is done (success, fail, or cancel)
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    }
  }

  async function handleSend() {
    const content = input.trim();
    const imageFile = pendingImageFile;
    // Capture blob URL BEFORE clearing so we can keep it alive during upload
    const imagePreviewUrl = pendingImagePreview;

    if ((!content && !imageFile) || sending || sendLockRef.current) return;

    sendLockRef.current = true;
    setSending(true);
    setError(null);

    const currentReplyTo = replyToRef.current;
    const tempId = `temp-${Date.now()}`;

    // Clear input state WITHOUT revoking the blob URL (runSend will revoke in finally)
    setPendingImagePreview(null);
    setPendingImageFile(null);
    setInput("");
    onClearReply();

    if (inputRef.current) {
      inputRef.current.style.height = "24px";
    }
    inputRef.current?.focus();

    try {
      await runSend({
        content,
        imageFile,
        imagePreviewUrl,
        replyTo: currentReplyTo,
        tempId,
      });
    } finally {
      sendLockRef.current = false;
    }
  }

  /**
   * Retries a failed send. Removes the old failed bubble, creates a fresh
   * optimistic one, and re-runs the upload + message flow.
   */
  const handleRetrySend = useCallback(async (failedTempId: string) => {
    const retryData = failedRetryDataRef.current.get(failedTempId);
    if (!retryData || sendingRef.current || sendLockRef.current) return;

    sendLockRef.current = true;

    // Remove the failed message before re-queueing
    setMessages((prev) => {
      const next = prev.filter((m) => m.id !== failedTempId);
      msgCache.set(communityId, next);
      return next;
    });
    failedRetryDataRef.current.delete(failedTempId);

    setSending(true);
    setError(null);

    const tempId = `temp-${Date.now()}`;
    // Create a fresh blob URL from the stored File for the new optimistic preview
    const imagePreviewUrl = retryData.file
      ? URL.createObjectURL(retryData.file)
      : null;

    try {
      await runSend({
        content: retryData.content,
        imageFile: retryData.file,
        imagePreviewUrl,
        replyTo: retryData.replyTo,
        tempId,
      });
    } finally {
      sendLockRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, setMessages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  /**
   * Send a GIF or sticker directly from an external URL (GIPHY).
   * No file upload needed — the URL is stored as image_url directly.
   */
  const handleGifSend = useCallback(async (gifUrl: string) => {
    if (sending || sendLockRef.current) return;
    sendLockRef.current = true;
    setSending(true);
    setError(null);

    const tempId = `temp-${Date.now()}`;

    const optimistic: Message = {
      id: tempId,
      content: "",
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: { name: currentUserName, avatar_url: currentUserAvatar },
      status: "sending",
      reactions: [],
      reply_to: null,
      image_url: gifUrl,
      mentions: [],
    };

    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });
    // Same instant sidebar bump as text/image sends.
    const prevSidebarEntry =
      sidebarStore.data?.communities.find((c) => c.id === communityId) ?? null;
    patchSidebarLastMessage(communityId, {
      id: tempId,
      content: "",
      created_at: optimistic.created_at,
      user: { name: currentUserName },
      is_own: true,
      has_image: true,
      is_reply: false,
      reply_to_user: null,
      is_deleted: false,
      reactions: [],
    });
    const rollbackSidebar = () => {
      if (!prevSidebarEntry) return;
      const current = sidebarStore.data?.communities.find(
        (c) => c.id === communityId
      );
      if (!current || current.last_message?.id !== tempId) return;
      restoreSidebarEntry(communityId, prevSidebarEntry);
    };
    // Jump to bottom so the GIF/sticker is immediately visible.
    requestAnimationFrame(() => {
      scrollToBottomRef.current?.scrollIntoView({ behavior: "instant" });
    });

    // Re-enable the input immediately — same pattern as text/image sends.
    setSending(false);

    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", image_url: gifUrl, mentions: [] }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 201) {
        setHideUnreadDivider(true);
        const message = data.message;
        if (!message) throw new Error("No message in response");

        setMessages((prev) => {
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
            const next = prev
              .filter((m) => m.id !== tempId)
              .map((m) => (m.id === message.id ? merged : m));
            msgCache.set(communityId, next);
            return next;
          }
          const next = prev.map((m) => m.id === tempId ? merged : m);
          msgCache.set(communityId, next);
          return next;
        });
      } else {
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === tempId ? { ...m, status: "failed" as const } : m,
          );
          msgCache.set(communityId, next);
          return next;
        });
        rollbackSidebar();
        setError((data as { error?: string }).error ?? "Failed to send.");
      }
    } catch {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === tempId ? { ...m, status: "failed" as const } : m,
        );
        msgCache.set(communityId, next);
        return next;
      });
      rollbackSidebar();
      setError("Network error.");
    } finally {
      sendLockRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, currentUserId, sending, setMessages]);

  return {
    input,
    setInput,
    sending,
    error,
    setError,
    handleSend,
    handleKeyDown,
    handleCancelSend,
    handleRetrySend,
    handleGifSend,
    inputRef,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
  };
}
