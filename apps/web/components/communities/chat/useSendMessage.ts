"use client";

import { useState, useEffect, useRef } from "react";
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

  const inputRef   = useRef<HTMLTextAreaElement>(null);
  // Keep a ref so handleSend always sees the latest replyTo without re-creating itself
  const replyToRef = useRef<ReplyPreview | null>(replyTo);
  useEffect(() => { replyToRef.current = replyTo; }, [replyTo]);

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

  async function handleSend() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);

    const currentReplyTo = replyToRef.current;

    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: null,
      status: "sending",
      reactions: [],
      reply_to: currentReplyTo ?? null,
    };
    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });
    setInput("");
    onClearReply();
    if (inputRef.current) inputRef.current.style.height = "24px";
    inputRef.current?.focus();

    try {
      const res = await fetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          reply_to_id: currentReplyTo?.id ?? null,
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
    } catch {
      setMessages((prev) => {
        const next = prev.map((m) => m.id === tempId ? { ...m, status: "failed" as const } : m);
        msgCache.set(communityId, next);
        return next;
      });
      setError("Network error.");
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

  return { input, setInput, sending, error, handleSend, handleKeyDown, inputRef };
}
