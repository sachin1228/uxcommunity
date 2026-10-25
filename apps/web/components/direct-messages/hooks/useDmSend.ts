"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { compressImage, compressedFile, preloadImage } from "@/lib/image-client";
import { dmUrls } from "@/lib/direct-messages/client";
import { dmCache } from "@/lib/direct-messages/client-cache";
import { compareDmMessages } from "@/lib/direct-messages/messages";
import {
  chatKey,
  newClientNonce,
  optimisticMessageId,
} from "@uxcommunity/offline-chat";
import {
  getOfflineChat,
  offlineRef,
  onOfflineChatChange,
} from "@/lib/offline/engine";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import type { DmMessage, DmPreviewMessage, DmRequestState } from "@/lib/direct-messages/types";
import type { ReplyPreview } from "@/lib/communities/cache";
import { MAX_MESSAGE_CHARS, scrollChatToBottom } from "@/components/communities/chat/chatUtils";

interface UseDmSendOptions {
  /** The OPEN conversation; sends are rejected while it is null. */
  conversationId: string | null;
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  setMessages: (next: DmMessage[] | ((current: DmMessage[]) => DmMessage[])) => void;
  setHideUnreadDivider: (value: boolean) => void;
  replyTo: ReplyPreview | null;
  onClearReply: () => void;
  /** The thread's scrollable body — pinned to the newest message on send. */
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  /** Conversation-list bump for the optimistic bubble (preview + reorder). */
  onPreview: (conversationId: string, tempId: string, preview: DmPreviewMessage) => void;
  /** The confirmed row replaces the optimistic preview id. */
  onPreviewConfirmed: (conversationId: string, tempId: string, preview: DmPreviewMessage) => void;
  /** Send failed before the row was confirmed — undo the optimistic bump. */
  onPreviewFailed: (conversationId: string, tempId: string) => void;
  /** The conversation's post-send request state — the first message defines
   *  the requester and a reply can be an implicit acceptance, so the row is
   *  patched straight from the response, no refetch. */
  onConversationState: (
    conversationId: string,
    requestState: DmRequestState,
    requestedBy: string | null,
  ) => void;
}

type RetryData = {
  /** The conversation the send belongs to — captured at dispatch, because
   *  the user can switch threads and cancel/retry from anywhere. */
  conversationId: string;
  file: File | null;
  content: string;
  replyTo: ReplyPreview | null;
  /** Idempotency key for this LOGICAL send — reused by every retry, so the
   *  server can recognize a re-sent attempt after a lost response. */
  nonce: string;
  /** URL of an upload this send already completed; a retry reuses it rather
   *  than uploading the file again. */
  uploadedUrl: string | null;
};

type SendArgs = {
  content: string;
  imageFile: File | null;
  imagePreviewUrl: string | null;
  replyTo: ReplyPreview | null;
  tempId: string;
  nonce: string;
  /** Uploaded URL carried over from a previous attempt (retry path). */
  preUploadedUrl?: string | null;
};

/**
 * A client-side idempotency key. `crypto.randomUUID` is available in every
 * supported browser (secure contexts); the fallback keeps the shape valid.
 */
function newNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}

/** The request columns a send response carries, defensively narrowed. */
function readRequestStatePayload(data: unknown): {
  requestState: DmRequestState;
  requestedBy: string | null;
} {
  const record = (typeof data === "object" && data !== null ? data : {}) as {
    request_state?: unknown;
    requested_by?: unknown;
  };
  const requestState: DmRequestState =
    record.request_state === "pending" || record.request_state === "rejected"
      ? record.request_state
      : "accepted";
  return {
    requestState,
    requestedBy: typeof record.requested_by === "string" ? record.requested_by : null,
  };
}

/**
 * Sending side of the DM composer — same optimistic contract as the
 * community chat's useSendMessage (temp bubble, per-send abort, retry payload,
 * blob → network image swap, GIF via URL), with the community-specific parts
 * (mentions, sidebar preview, content anchors) removed.
 */
export function useDmSend({
  conversationId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  setMessages,
  setHideUnreadDivider,
  replyTo,
  onClearReply,
  scrollContainerRef,
  onPreview,
  onPreviewConfirmed,
  onPreviewFailed,
  onConversationState,
}: UseDmSendOptions) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const dispatchingRef = useRef(false);
  const tempIdSeqRef = useRef(0);
  const nextTempId = useCallback(() => {
    tempIdSeqRef.current += 1;
    return `temp-${Date.now()}-${tempIdSeqRef.current}`;
  }, []);
  const failedRetryDataRef = useRef<Map<string, RetryData>>(new Map());

  // The conversation a send belongs to, captured at dispatch — the user can
  // switch threads while an upload is in flight and the POST must still land
  // in the original conversation.
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const replyToRef = useRef<ReplyPreview | null>(replyTo);
  useEffect(() => {
    replyToRef.current = replyTo;
  }, [replyTo]);

  // ── Durable outbox confirmations ──────────────────────────────────────────
  useEffect(() => {
    if (!conversationId) return undefined;
    const key = chatKey(offlineRef("dm", conversationId));
    let unsubscribe: (() => void) | null = null;
    const attach = (engine: ReturnType<typeof getOfflineChat>) => {
      unsubscribe?.();
      unsubscribe = null;
      if (!engine) return;
      unsubscribe = engine.subscribe((event) => {
        if (event.type === "connectivity") return;
        if (event.conversationKey !== key) return;

        if (event.type === "message-sent") {
          const tempId = optimisticMessageId(event.clientNonce);
          const message = event.message.payload as unknown as DmMessage;
          setMessages((prev) => {
            const optimisticRow = prev.find((m) => m.id === tempId);
            const existing = prev.find((m) => m.id === message.id);
            const merged: DmMessage = {
              ...(existing ?? optimisticRow ?? {}),
              ...message,
              users: message.users ?? existing?.users ?? optimisticRow?.users ?? null,
              reply_to: message.reply_to ?? existing?.reply_to ?? optimisticRow?.reply_to ?? null,
              image_url: message.image_url ?? existing?.image_url ?? optimisticRow?.image_url ?? null,
              status: "sent" as const,
              client_nonce: event.clientNonce,
            };
            const next = prev.filter((m) => m.id !== tempId && m.id !== message.id);
            next.push(merged);
            next.sort(compareDmMessages);
            dmCache.setMessages(
              conversationId,
              next.filter((m) => !m.id.startsWith("temp-")),
            );
            return next;
          });
          onPreviewConfirmed(conversationId, tempId, {
            id: message.id,
            content: message.content || null,
            image_url: message.image_url ?? null,
            created_at: message.created_at,
            user_id: message.user_id,
            deleted_at: null,
            edited_at: null,
          });
          const state = event.meta?.request_state;
          const requestedBy = event.meta?.requested_by;
          if (state === "pending" || state === "rejected" || state === "accepted") {
            onConversationState(
              conversationId,
              state,
              typeof requestedBy === "string" ? requestedBy : null,
            );
          }
          setHideUnreadDivider(true);
        } else if (event.type === "message-failed") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === optimisticMessageId(event.clientNonce)
                ? { ...m, status: "failed" as const }
                : m,
            ),
          );
          onPreviewFailed(conversationId, optimisticMessageId(event.clientNonce));
          setError(event.error);
        }
      });
    };
    const stop = onOfflineChatChange(attach);
    return () => {
      stop();
      unsubscribe?.();
    };
  }, [
    conversationId,
    onConversationState,
    onPreviewConfirmed,
    onPreviewFailed,
    setHideUnreadDivider,
    setMessages,
  ]);

  const prevPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevPreviewRef.current && prevPreviewRef.current !== pendingImagePreview) {
      URL.revokeObjectURL(prevPreviewRef.current);
    }
    prevPreviewRef.current = pendingImagePreview;
    return () => {
      if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the composer whenever a thread opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  // Typing anywhere focuses the composer (community-chat parity).
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [conversationId]);

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
    abortControllersRef.current.get(tempId)?.abort();
    abortControllersRef.current.delete(tempId);
    const retryData = failedRetryDataRef.current.get(tempId);
    // A durable outbox row has no in-flight request; removing its bubble here
    // would leave the queued message to send after the member dismissed it.
    if (!retryData && UUID_RE.test(tempId.replace(/^temp-/, ""))) return;
    if (retryData?.uploadedUrl) {
      // The upload finished but the send never did — release the asset.
      // The server skips the delete if a racing send already stored the URL,
      // and a later retry re-uploads (never a stale URL).
      const { conversationId: uploadConversationId, uploadedUrl } = retryData;
      retryData.uploadedUrl = null;
      void fetch(dmUrls.conversationUpload(uploadConversationId), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: uploadedUrl }),
      }).catch(() => {});
    }
    if (!retryData?.file) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      failedRetryDataRef.current.delete(tempId);
      const target = conversationIdRef.current;
      if (target) onPreviewFailed(target, tempId);
    }
  }, [setMessages, onPreviewFailed]);

  async function runSend({
    content,
    imageFile,
    imagePreviewUrl,
    replyTo: msgReplyTo,
    tempId,
    nonce,
    preUploadedUrl,
  }: SendArgs): Promise<void> {
    const targetConversationId = conversationIdRef.current;
    if (!targetConversationId) return;

    failedRetryDataRef.current.set(tempId, {
      conversationId: targetConversationId,
      file: imageFile,
      content,
      replyTo: msgReplyTo,
      nonce,
      uploadedUrl: preUploadedUrl ?? null,
    });

    const optimistic: DmMessage = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: { name: currentUserName, avatar_url: currentUserAvatar },
      status: "sending",
      reactions: [],
      reply_to: msgReplyTo ?? null,
      image_url: imagePreviewUrl,
    };

    setMessages((prev) => [...prev, optimistic]);
    onPreview(targetConversationId, tempId, {
      id: tempId,
      content: content || null,
      image_url: imagePreviewUrl,
      created_at: optimistic.created_at,
      user_id: currentUserId,
      deleted_at: null,
      edited_at: null,
    });
    requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));

    const abortController = new AbortController();
    abortControllersRef.current.set(tempId, abortController);

    try {
      // A retry reuses the URL the previous attempt already uploaded.
      let uploadedImageUrl: string | null = preUploadedUrl ?? null;

      if (imageFile && !uploadedImageUrl) {
        const fileToSend = await (async () => {
          try {
            return compressedFile(await compressImage(imageFile), imageFile);
          } catch {
            return imageFile;
          }
        })();
        const fd = new FormData();
        fd.append("file", fileToSend);

        const uploadRes = await fetch(dmUrls.conversationUpload(targetConversationId), {
          method: "POST",
          body: fd,
          signal: abortController.signal,
        });
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error ?? "Image upload failed.");
        }
        const uploadData: unknown = await uploadRes.json().catch(() => null);
        const bodyUrl =
          uploadData && typeof uploadData === "object" && "url" in uploadData && typeof uploadData.url === "string"
            ? uploadData.url.trim()
            : "";
        const headerUrl = uploadRes.headers.get("X-Image-Url")?.trim() ?? "";
        uploadedImageUrl = bodyUrl || headerUrl;
        if (!uploadedImageUrl) throw new Error("Image upload failed: the server returned an invalid response.");
        // Remember it on the retry payload, so a cancel can release the
        // asset and a retry can reuse it instead of uploading again.
        const entry = failedRetryDataRef.current.get(tempId);
        if (entry) entry.uploadedUrl = uploadedImageUrl;
      }

      const imagePreload = uploadedImageUrl ? preloadImage(uploadedImageUrl) : null;

      const res = await dedupeFetch(dmUrls.conversationMessages(targetConversationId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          reply_to_id: msgReplyTo?.id ?? null,
          image_url: uploadedImageUrl,
          // The idempotency key for this logical send — stable across
          // retries, so a lost response cannot mint a duplicate message.
          client_nonce: nonce,
        }),
        signal: abortController.signal,
      });

      const data = await res.json().catch(() => ({}));

      // 201 = inserted; 200 = the server recognized the nonce and returned
      // the ORIGINAL row (our first attempt landed but its response was
      // lost). Both confirm this bubble.
      if (res.ok) {
        setHideUnreadDivider(true);
        const message = data.message as DmMessage | undefined;
        if (!message) throw new Error("Server returned success without a message.");
        if (imagePreload) await imagePreload;

        setMessages((prev) => {
          const optimisticRow = prev.find((m) => m.id === tempId);
          const existing = prev.find((m) => m.id === message.id);
          const merged: DmMessage = {
            ...(existing ?? optimisticRow ?? {}),
            ...message,
            users: message.users ?? existing?.users ?? optimisticRow?.users ?? null,
            reply_to: message.reply_to ?? existing?.reply_to ?? optimisticRow?.reply_to ?? null,
            image_url: message.image_url ?? existing?.image_url ?? optimisticRow?.image_url ?? null,
            status: "sent" as const,
          };
          const next = prev
            .filter((m) => m.id !== tempId && m.id !== message.id);
          next.push(merged);
          next.sort(compareDmMessages);
          dmCache.setMessages(targetConversationId, next.filter((m) => !m.id.startsWith("temp-")));
          return next;
        });

        onPreviewConfirmed(targetConversationId, tempId, {
          id: message.id,
          content: message.content || null,
          image_url: message.image_url ?? null,
          created_at: message.created_at,
          user_id: message.user_id,
          deleted_at: null,
          edited_at: null,
        });
        const requestPayload = readRequestStatePayload(data);
        onConversationState(
          targetConversationId,
          requestPayload.requestState,
          requestPayload.requestedBy,
        );
        failedRetryDataRef.current.delete(tempId);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)));
        onPreviewFailed(targetConversationId, tempId);
        setError((data as { error?: string }).error ?? "Failed to send.");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        const retryData = failedRetryDataRef.current.get(tempId);
        if (retryData?.file) {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)));
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          failedRetryDataRef.current.delete(tempId);
        }
        onPreviewFailed(targetConversationId, tempId);
        return;
      }
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)));
      onPreviewFailed(targetConversationId, tempId);
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      abortControllersRef.current.delete(tempId);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    }
  }

  function beginSend(args: SendArgs): Promise<void> {
    dispatchingRef.current = true;
    try {
      return runSend(args);
    } finally {
      dispatchingRef.current = false;
    }
  }

  async function handleSend(): Promise<void> {
    const content = input.trim();
    const imageFile = pendingImageFile;
    const imagePreviewUrl = pendingImagePreview;

    if ((!content && !imageFile) || dispatchingRef.current) return;
    if (content.length > MAX_MESSAGE_CHARS) {
      setError(`Message is too long (max ${MAX_MESSAGE_CHARS} characters).`);
      return;
    }
    if (!conversationIdRef.current) return;

    setError(null);

    // ── Durable text path ──────────────────────────────────────────────────
    // Text-only DMs queue exactly like community messages: optimistic row and
    // outbox record committed together, one nonce reused by every retry, and
    // the server's request-state transition carried back in the response meta.
    const offlineEngine = getOfflineChat();
    if (offlineEngine && !imageFile) {
      dispatchingRef.current = true;
      try {
        const targetConversationId = conversationIdRef.current;
        const currentReplyTo = replyToRef.current;
        const nonce = newClientNonce();
        const tempId = optimisticMessageId(nonce);
        const optimistic: DmMessage = {
          id: tempId,
          content,
          created_at: new Date().toISOString(),
          user_id: currentUserId,
          users: { name: currentUserName, avatar_url: currentUserAvatar },
          status: "queued",
          reactions: [],
          reply_to: currentReplyTo ?? null,
          image_url: null,
          client_nonce: nonce,
        };

        setMessages((prev) => [...prev, optimistic]);
        onPreview(targetConversationId, tempId, {
          id: tempId,
          content: content || null,
          image_url: null,
          created_at: optimistic.created_at,
          user_id: currentUserId,
          deleted_at: null,
          edited_at: null,
        });
        setPendingImagePreview(null);
        setPendingImageFile(null);
        setInput("");
        onClearReply();
        if (inputRef.current) inputRef.current.style.height = "24px";
        inputRef.current?.focus();
        requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));

        void offlineEngine
          .enqueueText({
            ref: offlineRef("dm", targetConversationId),
            content,
            replyToId: currentReplyTo?.id ?? null,
            replyToContent: null,
            mentionUserIds: [],
            optimisticPayload: optimistic as unknown as Record<string, unknown>,
            clientNonce: nonce,
          })
          .catch(() => {
            setMessages((prev) =>
              prev.map((row) =>
                row.id === tempId ? { ...row, status: "failed" as const } : row,
              ),
            );
            onPreviewFailed(targetConversationId, tempId);
            setError("Could not save this message on this device. Please try again.");
          });
      } finally {
        dispatchingRef.current = false;
      }
      return;
    }

    const currentReplyTo = replyToRef.current;
    const tempId = nextTempId();

    setPendingImagePreview(null);
    setPendingImageFile(null);
    setInput("");
    onClearReply();
    if (inputRef.current) inputRef.current.style.height = "24px";
    inputRef.current?.focus();

    await beginSend({
      content,
      imageFile,
      imagePreviewUrl,
      replyTo: currentReplyTo,
      tempId,
      nonce: newNonce(),
    });
  }

  const handleRetrySend = useCallback(
    async (failedTempId: string) => {
      const outboxNonce = failedTempId.startsWith("temp-")
        ? failedTempId.slice("temp-".length)
        : "";
      const offlineEngine = getOfflineChat();
      if (offlineEngine && UUID_RE.test(outboxNonce)) {
        setError(null);
        try {
          await offlineEngine.retry(outboxNonce);
        } catch {
          setError("Could not retry this message. Please try again.");
        }
        return;
      }

      const retryData = failedRetryDataRef.current.get(failedTempId);
      if (!retryData) return;
      setMessages((prev) => prev.filter((m) => m.id !== failedTempId));
      const target = conversationIdRef.current;
      if (target) onPreviewFailed(target, failedTempId);
      failedRetryDataRef.current.delete(failedTempId);

      setError(null);
      const imagePreviewUrl = retryData.file ? URL.createObjectURL(retryData.file) : null;
      // The SAME nonce: this is the same logical send, and the server answers
      // a recognized nonce with the original row instead of a duplicate.
      await beginSend({
        content: retryData.content,
        imageFile: retryData.file,
        imagePreviewUrl,
        replyTo: retryData.replyTo,
        tempId: failedTempId,
        nonce: retryData.nonce,
        preUploadedUrl: retryData.uploadedUrl,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setMessages, nextTempId, onPreviewFailed],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  /** Send a GIF or sticker directly from an external URL (GIPHY). */
  const handleGifSend = useCallback(
    async (gifUrl: string) => {
      const targetConversationId = conversationIdRef.current;
      if (!targetConversationId) return;
      setError(null);

      const tempId = nextTempId();
      const optimistic: DmMessage = {
        id: tempId,
        content: "",
        created_at: new Date().toISOString(),
        user_id: currentUserId,
        users: { name: currentUserName, avatar_url: currentUserAvatar },
        status: "sending",
        reactions: [],
        reply_to: null,
        image_url: gifUrl,
      };
      setMessages((prev) => [...prev, optimistic]);
      onPreview(targetConversationId, tempId, {
        id: tempId,
        content: null,
        image_url: gifUrl,
        created_at: optimistic.created_at,
        user_id: currentUserId,
        deleted_at: null,
        edited_at: null,
      });
      requestAnimationFrame(() => scrollChatToBottom(scrollContainerRef.current));

      const abortController = new AbortController();
      abortControllersRef.current.set(tempId, abortController);

      try {
        const res = await dedupeFetch(dmUrls.conversationMessages(targetConversationId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "", image_url: gifUrl, client_nonce: newNonce() }),
          signal: abortController.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setHideUnreadDivider(true);
          const message = data.message as DmMessage | undefined;
          if (!message) throw new Error("No message in response");
          setMessages((prev) => {
            const optimisticRow = prev.find((m) => m.id === tempId);
            const merged: DmMessage = {
              ...(optimisticRow ?? {}),
              ...message,
              users: message.users ?? optimisticRow?.users ?? null,
              reply_to: message.reply_to ?? optimisticRow?.reply_to ?? null,
              image_url: message.image_url ?? optimisticRow?.image_url ?? null,
              status: "sent" as const,
            };
            const next = prev.filter((m) => m.id !== tempId && m.id !== message.id);
            next.push(merged);
            next.sort(compareDmMessages);
            dmCache.setMessages(targetConversationId, next.filter((m) => !m.id.startsWith("temp-")));
            return next;
          });
          onPreviewConfirmed(targetConversationId, tempId, {
            id: message.id,
            content: null,
            image_url: message.image_url ?? null,
            created_at: message.created_at,
            user_id: message.user_id,
            deleted_at: null,
            edited_at: null,
          });
          const requestPayload = readRequestStatePayload(data);
          onConversationState(
            targetConversationId,
            requestPayload.requestState,
            requestPayload.requestedBy,
          );
        } else {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)));
          onPreviewFailed(targetConversationId, tempId);
          setError((data as { error?: string }).error ?? "Failed to send.");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)));
          setError("Network error.");
        }
        onPreviewFailed(targetConversationId, tempId);
      } finally {
        abortControllersRef.current.delete(tempId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, currentUserName, currentUserAvatar, setMessages, nextTempId, onPreview, onPreviewConfirmed, onPreviewFailed, onConversationState],
  );

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
