"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { MessageMention, ReplyPreview } from "@/lib/communities/cache";
import { MAX_MESSAGE_CHARS } from "./chatUtils";
import { runGifSend } from "./send-message/gif-send";
import { commitToCommunityCache, removeMessage, updateMessages } from "./send-message/message-list";
import { runSend } from "./send-message/run-send";
import type {
  RetryData,
  SendArgs,
  SendContext,
  SendResult,
  UseSendMessageOptions,
} from "./send-message/types";
import { useComposerFocus } from "./send-message/useComposerFocus";
import { usePendingImage } from "./send-message/usePendingImage";

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

  const {
    pendingImageFile,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
    detachPendingImage,
  } = usePendingImage();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  useComposerFocus(inputRef, communityId);

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

  const sendContext: SendContext = {
    communityId,
    currentUserId,
    currentUserName,
    currentUserAvatar,
    setMessages,
    setHideUnreadDivider,
    setError,
    scrollContainerRef,
    abortControllers: abortControllersRef.current,
    failedRetryData: failedRetryDataRef.current,
    resolveMentionsFor,
  };

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
      updateMessages(setMessages, communityId, removeMessage(tempId));
      failedRetryDataRef.current.delete(tempId);
    }
  }, [communityId, setMessages]);

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
      return runSend(sendContext, args);
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
    detachPendingImage();
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
    if (result.sentCommunityId && result.sentCommunityId !== communityId && confirmed) {
      commitToCommunityCache(result.sentCommunityId, tempId, confirmed);
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
    updateMessages(setMessages, communityId, removeMessage(failedTempId));
    failedRetryDataRef.current.delete(failedTempId);

    setError(null);

    const tempId = nextTempId();
    // Create a fresh blob URL from the stored File for the new optimistic preview
    const imagePreviewUrl = retryData.file ? URL.createObjectURL(retryData.file) : null;

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

  const handleGifSend = useCallback(async (gifUrl: string) => {
    // No in-flight guard: a GIF is picked explicitly from the picker (which
    // closes on select), so there is no stale-composer duplicate to protect
    // against — and concurrent sends are exactly what this hook now allows.
    setError(null);
    await runGifSend(sendContext, gifUrl, nextTempId());
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
