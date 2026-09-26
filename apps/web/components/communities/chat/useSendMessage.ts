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
import { MAX_MESSAGE_CHARS, scrollChatToBottom } from "./chatUtils";

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
  /** The chat's scrollable message body — pinned to the newest message on every send. */
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  /** Resolves the members @mentioned in the final text (composer registry). */
  resolveMentions?: (content: string) => MessageMention[];
}

type RetryData = {
  file: File | null;
  content: string;
  replyTo: ReplyPreview | null;
};

/** Everything one send needs — shared by the composer, retry and GIF paths. */
type SendArgs = {
  content: string;
  imageFile: File | null;
  imagePreviewUrl: string | null;
  replyTo: ReplyPreview | null;
  tempId: string;
};

type SendResult = { sentCommunityId: string | null; message: Message | null };

export function useSendMessage({
  communityId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  setMessages,
  setHideUnreadDivider,
  replyTo,
  onClearReply,
  scrollContainerRef,
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
  const [error, setError] = useState<string | null>(null);

  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Concurrent sends ──────────────────────────────────────────────────────
  // Sends never wait for each other: the optimistic bubble is on screen
  // immediately, so the next message must be dispatchable while the previous
  // POST (or image upload) is still in flight. Each send owns its own
  // AbortController, keyed by temp id, so cancelling one bubble can never abort
  // another message's request.
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Re-entry guard that only spans the *synchronous* part of a dispatch. React
  // batches the optimistic updates, so a duplicated dispatch inside one event
  // tick (held Enter, double-clicked Send) would still read the old `input` and
  // POST the same text twice. The guard is released as soon as the request has
  // been created — the network part then runs in the background.
  const dispatchingRef = useRef(false);

  // Temp ids are the identity of an optimistic bubble, so they must be unique
  // even when two sends start within the same millisecond — a bare
  // `temp-${Date.now()}` collides, and the colliding bubble overwrote the first
  // one in the very same render.
  const tempIdSeqRef = useRef(0);
  const nextTempId = useCallback(() => {
    tempIdSeqRef.current += 1;
    return `temp-${Date.now()}-${tempIdSeqRef.current}`;
  }, []);

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
    // Only this message's request is aborted — other sends still uploading keep
    // theirs, which is why the controller is looked up by temp id.
    abortControllersRef.current.get(tempId)?.abort();
    abortControllersRef.current.delete(tempId);

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
  }: SendArgs): Promise<SendResult> {
    // Set when the POST confirms the message landed — used by the caller to
    // re-commit the row if the user switched communities mid-upload.
    let lastConfirmedMessage: Message | null = null;
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
      // A reply anchored to a "created a …" card names the kind, not a person.
      reply_to_user:
        msgReplyTo && !msgReplyTo.content_kind
          ? msgReplyTo.user_name.split(" ")[0]
          : null,
      reply_to_content_kind: msgReplyTo?.content_kind ?? null,
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
    // Always jump to the bottom: the message just sent is the newest row, so
    // it is what the user expects to see — even when they sent it while
    // scrolled up reading older history. Running in a rAF puts the jump after
    // the optimistic bubble has been committed and laid out, so `scrollHeight`
    // already includes it.
    requestAnimationFrame(() =>
      scrollChatToBottom(scrollContainerRef.current),
    );

    const abortController = new AbortController();
    abortControllersRef.current.set(tempId, abortController);
    const sentCommunityId = communityId;

    const runClientOperation = <T,>(operation: () => Promise<T>) => operation();

    try {
      let uploadedImageUrl: string | null = null;

      if (imageFile) {
        // Compress on the client (canvas → WebP); the upload route stores the
        // bytes as-is since server-side Sharp is unavailable on Workers.
        const fileToSend = await runClientOperation(async () => {
          try {
            return compressedFile(await compressImage(imageFile), imageFile);
          } catch {
            return imageFile;
          }
        });
        const fd = new FormData();
        fd.append("file", fileToSend);

        const uploadRes = await runClientOperation(() =>
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

      const res = await runClientOperation(() =>
        dedupeFetch(`/api/communities/${communityId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            // Message replies and content replies are mutually exclusive: a
            // content reply's id is a thread/showcase/resource/event id, not a
            // message id — sending it as reply_to_id would make the API try
            // (and fail) to validate it as a message and drop the anchor.
            reply_to_id: msgReplyTo?.content_kind ? null : msgReplyTo?.id ?? null,
            // Replies anchored to a content item (a "created a …" card) ride
            // alongside; the API ignores it when reply_to_id is set.
            reply_to_content:
              msgReplyTo?.content_kind
                ? { id: msgReplyTo.id, kind: msgReplyTo.content_kind }
                : null,
            image_url: uploadedImageUrl,
            mentions: mentions.map((m) => ({ user_id: m.user_id })),
            // Each send carries its own nonce, so two identical messages ("ok",
            // "ok") never share a request key. dedupeFetch joins identical
            // in-flight requests and replays recently settled ones by
            // method + URL + body — without the nonce the second bubble would
            // merge with the first response and never reach the server.
            client_nonce: tempId,
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
          lastConfirmedMessage = merged;

          if (existing) {
            // Realtime beat the API response — update the existing real entry.
            // The optimistic bubble may ALREADY be gone: the echo of an earlier
            // send used to remove every temp- row by this user, which turned
            // this map into a no-op and left the message missing. Append
            // defensively when both the temp and the real row are absent.
            const next = prev
              .filter((m) => m.id !== tempId)
              .some((m) => m.id === message.id)
              ? prev.filter((m) => m.id !== tempId).map((m) => (m.id === message.id ? merged : m))
              : [...prev.filter((m) => m.id !== tempId), merged].sort(
                  (a, b) =>
                    new Date(a.created_at).getTime() -
                    new Date(b.created_at).getTime(),
                );
            msgCache.set(communityId, next);
            return next;
          }

          const next = prev.map((m) => (m.id === tempId ? merged : m));
          if (!next.some((m) => m.id === message.id)) {
            // Same defensive append for the no-echo path: if the optimistic
            // bubble was removed elsewhere, add the confirmed message back
            // instead of silently dropping it.
            const appended = [...next.filter((m) => m.id !== tempId), merged].sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
            );
            msgCache.set(communityId, appended);
            return appended;
          }
          msgCache.set(communityId, next);
          return next;
        });

        // Sent successfully — clear retry data
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
        // Abort before confirmation: nothing was sent, report nothing.
        return { sentCommunityId: null, message: null };
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
      abortControllersRef.current.delete(tempId);
      // Revoke the blob URL now that upload is done (success, fail, or cancel)
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    }

    // Success commit — make it resilient to a community switch mid-upload:
    // the state updater above is bound to the community the user navigated
    // AWAY from, so capture the result and commit it to whichever community
    // is mounted now if that changed.
    return { sentCommunityId, message: lastConfirmedMessage };
  }

  /**
   * Dispatches a send under the same-tick re-entry guard.
   *
   * `runSend`'s synchronous prologue (optimistic bubble, sidebar bump, scroll
   * pin, input clear) all runs before its first await, so the guard can be
   * released the moment the request has been created: a message typed while an
   * earlier one is still uploading goes out straight away, and only a duplicate
   * dispatch inside the very same event tick is dropped.
   */
  function beginSend(args: SendArgs): Promise<SendResult> {
    dispatchingRef.current = true;
    try {
      return runSend(args);
    } finally {
      dispatchingRef.current = false;
    }
  }

  async function handleSend() {
    const content = input.trim();
    const imageFile = pendingImageFile;
    // Capture blob URL BEFORE clearing so we can keep it alive during upload
    const imagePreviewUrl = pendingImagePreview;

    // No `sending` check: a message typed while an earlier send is still in
    // flight is dispatched immediately. `dispatchingRef` only closes the gap
    // inside a single event tick.
    if ((!content && !imageFile) || dispatchingRef.current) return;
    // Final guard — the composer caps input, but never send over the limit.
    if (content.length > MAX_MESSAGE_CHARS) {
      setError(`Message is too long (max ${MAX_MESSAGE_CHARS} characters).`);
      return;
    }

    setError(null);

    const currentReplyTo = replyToRef.current;
    const tempId = nextTempId();

    // Clear input state WITHOUT revoking the blob URL (runSend will revoke in finally)
    setPendingImagePreview(null);
    setPendingImageFile(null);
    setInput("");
    onClearReply();

    if (inputRef.current) {
      inputRef.current.style.height = "24px";
    }
    inputRef.current?.focus();

    const result = await beginSend({
      content,
      imageFile,
      imagePreviewUrl,
      replyTo: currentReplyTo,
      tempId,
    });

    // If the user navigated to another community mid-send, the state updater
    // above ran against the OLD community's setMessages and never reached the
    // UI. Commit the confirmed row into the message cache directly — it is
    // keyed by community id — so the message is never lost. (No abort: the
    // POST already returned 201, so the message exists server-side.)
    const confirmed = result.message;
    if (
      result.sentCommunityId &&
      result.sentCommunityId !== communityId &&
      confirmed
    ) {
      const cached = msgCache.get(result.sentCommunityId) ?? [];
      if (!cached.some((m) => m.id === confirmed.id)) {
        const withoutTemp = cached.filter((m) => m.id !== tempId);
        const next = [...withoutTemp, confirmed].sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime(),
        );
        msgCache.set(result.sentCommunityId, next);
      }
      failedRetryDataRef.current.delete(tempId);
    }
  }

  /**
   * Retries a failed send. Removes the old failed bubble, creates a fresh
   * optimistic one, and re-runs the upload + message flow.
   */
  const handleRetrySend = useCallback(async (failedTempId: string) => {
    // The retry payload is consumed synchronously below, so a double-click on
    // Retry can never queue two sends for the same bubble — and a retry for a
    // bubble that scrolled out of the previous chat window is dropped instead
    // of firing invisibly into another community.
    const retryData = failedRetryDataRef.current.get(failedTempId);
    if (!retryData) return;

    // Remove the failed message before re-queueing
    setMessages((prev) => {
      const next = prev.filter((m) => m.id !== failedTempId);
      msgCache.set(communityId, next);
      return next;
    });
    failedRetryDataRef.current.delete(failedTempId);

    setError(null);

    const tempId = nextTempId();
    // Create a fresh blob URL from the stored File for the new optimistic preview
    const imagePreviewUrl = retryData.file
      ? URL.createObjectURL(retryData.file)
      : null;

    await beginSend({
      content: retryData.content,
      imageFile: retryData.file,
      imagePreviewUrl,
      replyTo: retryData.replyTo,
      tempId,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, setMessages, nextTempId]);

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
    // No in-flight guard: a GIF is picked explicitly from the picker (which
    // closes on select), so there is no stale-composer duplicate to protect
    // against — and concurrent sends are exactly what this hook now allows.
    setError(null);

    const tempId = nextTempId();

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
    // Always jump to the bottom (same reasoning as text/image sends).
    requestAnimationFrame(() =>
      scrollChatToBottom(scrollContainerRef.current),
    );

    // Tracked like every other send, so cancelling this bubble aborts this
    // request — not whichever send happened to start last.
    const abortController = new AbortController();
    abortControllersRef.current.set(tempId, abortController);

    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same per-send nonce as text/image sends: posting the same GIF twice
        // in a row must produce two messages, not one deduped request.
        body: JSON.stringify({
          content: "",
          image_url: gifUrl,
          mentions: [],
          client_nonce: tempId,
        }),
        signal: abortController.signal,
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
    } catch (err) {
      // A cancelled GIF send already removed its bubble (and has no retry
      // payload), so only a real failure marks the row failed.
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === tempId ? { ...m, status: "failed" as const } : m,
          );
          msgCache.set(communityId, next);
          return next;
        });
        setError("Network error.");
      }
      rollbackSidebar();
    } finally {
      abortControllersRef.current.delete(tempId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, currentUserId, setMessages, nextTempId]);

  return {
    input,
    setInput,
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
