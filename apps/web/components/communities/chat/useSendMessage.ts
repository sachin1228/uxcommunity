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
  const [input,   setInput]   = useState("");
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── Pending image ────────────────────────────────────────────────────────
  const [pendingImageFile,    setPendingImageFile]    = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);

  const inputRef   = useRef<HTMLTextAreaElement>(null);
  // Keep a ref so handleSend always sees the latest replyTo without re-creating itself
  const replyToRef = useRef<ReplyPreview | null>(replyTo);
  useEffect(() => { replyToRef.current = replyTo; }, [replyTo]);

  // Revoke the object URL when the preview changes or on unmount
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

  // Auto-focus when community changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [communityId]);

  // Global keydown → redirect stray typing into the input
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement)?.isContentEditable) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
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

  async function handleSend() {
    const content   = input.trim();
    const imageFile = pendingImageFile;
    if ((!content && !imageFile) || sending) return;
    setSending(true);
    setError(null);

    const currentReplyTo = replyToRef.current;

    // Optimistic message — use local blob URL as preview while uploading
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id:         tempId,
      content,
      created_at: new Date().toISOString(),
      user_id:    currentUserId,
      users:      null,
      status:     "sending",
      reactions:  [],
      reply_to:   currentReplyTo ?? null,
      image_url:  pendingImagePreview, // local blob URL for instant preview
    };
    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });

    setInput("");
    handleImageClear();
    onClearReply();
    if (inputRef.current) inputRef.current.style.height = "24px";
    inputRef.current?.focus();

    try {
      // 1. Upload image server-side if one was picked
      let uploadedImageUrl: string | null = null;
      if (imageFile) {
        const fd = new FormData();
        fd.append("file", imageFile);
        const uploadRes = await fetch(`/api/communities/${communityId}/messages/upload`, {
          method: "POST",
          body:   fd,
        });
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error ?? "Image upload failed.");
        }
        const { url } = await uploadRes.json();
        uploadedImageUrl = url;
      }

      // 2. Send the message record
      const res = await fetch(`/api/communities/${communityId}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          content,
          reply_to_id: currentReplyTo?.id ?? null,
          image_url:   uploadedImageUrl,
        }),
      });

      if (res.ok) {
        setHideUnreadDivider(true);
        const { message } = await res.json();
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
      } else {
        const d = await res.json();
        setMessages((prev) => {
          const next = prev.map((m) => m.id === tempId ? { ...m, status: "failed" as const } : m);
          msgCache.set(communityId, next);
          return next;
        });
        setError(d.error ?? "Failed to send.");
      }
    } catch (err) {
      setMessages((prev) => {
        const next = prev.map((m) => m.id === tempId ? { ...m, status: "failed" as const } : m);
        msgCache.set(communityId, next);
        return next;
      });
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return {
    input, setInput, sending, error, handleSend, handleKeyDown, inputRef,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
  };
}
