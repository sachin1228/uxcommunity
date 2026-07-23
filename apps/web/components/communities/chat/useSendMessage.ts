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
    setMessages((prev) => {
      const next = prev.filter((m) => m.id !== tempId);
      msgCache.set(communityId, next);
      return next;
    });
  }, [communityId, setMessages]);

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

    // Clear input state WITHOUT revoking the blob URL (we need it for display)
    setPendingImagePreview(null);
    setPendingImageFile(null);
    setInput("");
    onClearReply();

    if (inputRef.current) {
      inputRef.current.style.height = "24px";
    }
    inputRef.current?.focus();

    const optimistic: Message = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: null,
      status: "sending",
      reactions: [],
      reply_to: currentReplyTo ?? null,
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
          reply_to_id: currentReplyTo?.id ?? null,
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
            const next = prev.filter((m) => m.id !== tempId);
            msgCache.set(communityId, next);
            return next;
          }

          const next = prev.map((m) =>
            m.id === tempId ? { ...message, status: "sent" as const } : m
          );

          msgCache.set(communityId, next);
          return next;
        });
      } else if (res.status === 202) {
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== tempId);
          msgCache.set(communityId, next);
          return next;
        });

        setError(data.error ?? "Your message has been sent for moderator review.");
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
        // Cancelled by handleCancelSend — message already removed, no error shown
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return {
    input,
    setInput,
    sending,
    error,
    handleSend,
    handleKeyDown,
    handleCancelSend,
    inputRef,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
  };
}