"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { msgCache } from "@/lib/communities/cache";
import type { CachedMessage, ReplyPreview } from "@/lib/communities/cache";

type Message = CachedMessage;

interface UseSendMessageOptions {
  communityId: string;
  currentUserId: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setHideUnreadDivider: (val: boolean) => void;
  replyTo: ReplyPreview | null;
  onClearReply: () => void;
}

type RetryData = {
  file: File | null;
  content: string;
  replyTo: ReplyPreview | null;
};

export function useSendMessage({
  communityId,
  currentUserId,
  setMessages,
  setHideUnreadDivider,
  replyTo,
  onClearReply,
}: UseSendMessageOptions) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

    const optimistic: Message = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: null,
      status: "sending",
      reactions: [],
      reply_to: msgReplyTo ?? null,
      image_url: imagePreviewUrl,
    };

    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      let uploadedImageUrl: string | null = null;

      if (imageFile) {
        const fd = new FormData();
        fd.append("file", imageFile);

        const uploadRes = await fetch(
          `/api/communities/${communityId}/messages/upload`,
          { method: "POST", body: fd, signal: abortController.signal }
        );

        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error ?? "Image upload failed.");
        }

        const { url } = await uploadRes.json();
        uploadedImageUrl = url;
      }

      const res = await fetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          reply_to_id: msgReplyTo?.id ?? null,
          image_url: uploadedImageUrl,
        }),
        signal: abortController.signal,
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 201) {
        setHideUnreadDivider(true);

        const message = data.message;

        if (!message) {
          throw new Error("Server returned success without a message.");
        }

        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) {
            // Realtime beat the API response — the existing entry lacks reply_to
            // and image_url. Replace it with the full server payload.
            const next = prev
              .filter((m) => m.id !== tempId)
              .map((m) =>
                m.id === message.id ? { ...message, status: "sent" as const } : m
              );
            msgCache.set(communityId, next);
            return next;
          }

          const next = prev.map((m) =>
            m.id === tempId ? { ...message, status: "sent" as const } : m
          );

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
        return;
      }

      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === tempId ? { ...m, status: "failed" as const } : m
        );
        msgCache.set(communityId, next);
        return next;
      });
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      // Revoke the blob URL now that upload is done (success, fail, or cancel)
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    }
  }

  async function handleSend() {
    const content = input.trim();
    const imageFile = pendingImageFile;
    // Capture blob URL BEFORE clearing so we can keep it alive during upload
    const imagePreviewUrl = pendingImagePreview;

    if ((!content && !imageFile) || sending) return;

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

    await runSend({
      content,
      imageFile,
      imagePreviewUrl,
      replyTo: currentReplyTo,
      tempId,
    });
  }

  /**
   * Retries a failed send. Removes the old failed bubble, creates a fresh
   * optimistic one, and re-runs the upload + message flow.
   */
  const handleRetrySend = useCallback(async (failedTempId: string) => {
    const retryData = failedRetryDataRef.current.get(failedTempId);
    if (!retryData || sending) return;

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

    await runSend({
      content: retryData.content,
      imageFile: retryData.file,
      imagePreviewUrl,
      replyTo: retryData.replyTo,
      tempId,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, sending, setMessages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
    if (sending) return;
    setSending(true);
    setError(null);

    const tempId = `temp-${Date.now()}`;

    const optimistic: Message = {
      id: tempId,
      content: "",
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: null,
      status: "sending",
      reactions: [],
      reply_to: null,
      image_url: gifUrl,
    };

    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });

    try {
      const res = await fetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", image_url: gifUrl }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 201) {
        setHideUnreadDivider(true);
        const message = data.message;
        if (!message) throw new Error("No message in response");

        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) {
            const next = prev
              .filter((m) => m.id !== tempId)
              .map((m) => (m.id === message.id ? { ...message, status: "sent" as const } : m));
            msgCache.set(communityId, next);
            return next;
          }
          const next = prev.map((m) =>
            m.id === tempId ? { ...message, status: "sent" as const } : m,
          );
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
      setError("Network error.");
    } finally {
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, currentUserId, sending, setMessages]);

  return {
    input,
    setInput,
    sending,
    error,
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
