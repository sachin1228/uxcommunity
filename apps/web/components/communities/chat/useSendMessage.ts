"use client";

import { useState, useEffect, useRef } from "react";
import { msgCache } from "@/lib/communities/cache";
import type { CachedMessage } from "@/lib/communities/cache";

type Message = CachedMessage;

interface UseSendMessageOptions {
  communityId: string;
  currentUserId: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setHideUnreadDivider: (val: boolean) => void;
}

export function useSendMessage({
  communityId,
  currentUserId,
  setMessages,
  setHideUnreadDivider,
}: UseSendMessageOptions) {
  const [input,   setInput]   = useState("");
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Auto-focus when community changes ────────────────────────────────────
  useEffect(() => {
    inputRef.current?.focus();
  }, [communityId]);

  // ── Global keydown → redirect stray typing into the input ─────────────────
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [communityId]);

  // ── Send handler ──────────────────────────────────────────────────────────
  async function handleSend() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);

    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: null,
      status: "sending",
    };
    setMessages((prev) => {
      const next = [...prev, optimistic];
      msgCache.set(communityId, next);
      return next;
    });
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "24px";
    inputRef.current?.focus();

    try {
      const res = await fetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
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
          const next = prev.map((m) =>
            m.id === tempId ? { ...m, status: "failed" as const } : m
          );
          msgCache.set(communityId, next);
          return next;
        });
        setError(d.error ?? "Failed to send.");
      }
    } catch {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === tempId ? { ...m, status: "failed" as const } : m
        );
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

  return {
    input,
    setInput,
    sending,
    error,
    handleSend,
    handleKeyDown,
    inputRef,
  };
}
