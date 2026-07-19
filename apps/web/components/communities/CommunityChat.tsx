"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Users, Clock, CheckCheck, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { createBrowserClient } from "@/lib/supabase/browser";

interface Sender {
  name: string;
  avatar_url: string | null;
}

interface Message {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  users: Sender | null;
  // optimistic UI only — not stored in DB
  status?: "sending" | "sent" | "failed";
}

interface Community {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
}

interface Member {
  user_id: string;
  users: Sender | null;
}

const TYPE_EMOJI: Record<string, string> = { city: "📍", sector: "🏢", interest: "✦" };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Avatar({ name, url, size = 8 }: { name: string; url: string | null; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const px = size * 4;
  if (url) {
    return <img src={url} alt={name} width={px} height={px} className={`rounded-full object-cover h-${size} w-${size} shrink-0`} />;
  }
  return (
    <div className={`h-${size} w-${size} shrink-0 rounded-full bg-accent/20 flex items-center justify-center font-body text-xs font-semibold text-accent select-none`}>
      {initials}
    </div>
  );
}

export function CommunityChat({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showMembersDropdown, setShowMembersDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const membersDropdownRef = useRef<HTMLDivElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (membersDropdownRef.current && !membersDropdownRef.current.contains(e.target as Node)) {
        setShowMembersDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load community + messages
  const fetchMessages = useCallback(async () => {
    const [commRes, msgRes] = await Promise.all([
      fetch(`/api/communities/${communityId}`),
      fetch(`/api/communities/${communityId}/messages`),
    ]);
    if (commRes.ok) {
      const d = await commRes.json();
      setCommunity(d.community);
      setMembers(d.members ?? []);
    }
    if (msgRes.ok) {
      const d = await msgRes.json();
      setMessages(d.messages ?? []);
    }
    setLoading(false);
  }, [communityId]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setCommunity(null);
    fetchMessages();
  }, [fetchMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Supabase Realtime subscription
  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

    const channel = supabase
      .channel(`community:${communityId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_messages",
          filter: `community_id=eq.${communityId}`,
        },
        () => {
          // Refetch messages on new insert so we get full user info
          fetchMessages();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [communityId, fetchMessages]);

  async function handleSend() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);

    // Optimistic message — shown immediately with clock icon
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: currentUserId,
      users: null,
      status: "sending",
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    // Reset textarea height back to single line
    if (inputRef.current) {
      inputRef.current.style.height = "24px";
    }
    inputRef.current?.focus();

    try {
      const res = await fetch(`/api/communities/${communityId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const { message } = await res.json();
        // Replace optimistic with real message (gets double-tick)
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...message, status: "sent" } : m))
        );
      } else {
        const d = await res.json();
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m))
        );
        setError(d.error ?? "Failed to send.");
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m))
      );
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

  // Group messages by date
  type Group = { date: string; messages: Message[] };
  const grouped = messages.reduce<Group[]>((acc, msg) => {
    const date = fmtDate(msg.created_at);
    const last = acc[acc.length - 1];
    if (last?.date === date) { last.messages.push(msg); }
    else { acc.push({ date, messages: [msg] }); }
    return acc;
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-5 w-5 text-foreground-muted" />
      </div>
    );
  }

  if (!community) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="font-body text-sm text-foreground-muted">Community not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Chat header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-surface-raised flex items-center justify-center text-sm shrink-0 overflow-hidden">
            {community.image_url
              ? <img
                  src={community.image_url}
                  alt={community.name}
                  className="h-9 w-9 rounded-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    e.currentTarget.parentElement!.textContent = TYPE_EMOJI[community.type] ?? "💬";
                  }}
                />
              : TYPE_EMOJI[community.type] ?? "💬"}
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-foreground leading-none">{community.name}</h3>
            <p className="font-body text-[11px] text-foreground-muted mt-0.5 flex items-center gap-1">
              <Users size={10} /> {community.member_count} member{community.member_count !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Users size={14} className="text-foreground-muted" />
          <span className="font-body text-xs text-foreground-muted">{community.member_count} member{community.member_count !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Body: messages + optional members panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
            {grouped.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
                <div className="h-12 w-12 rounded-full bg-surface-raised flex items-center justify-center text-2xl">
                  {TYPE_EMOJI[community.type] ?? "💬"}
                </div>
                <p className="font-body text-sm text-foreground-muted text-center">
                  Welcome to <span className="font-medium text-foreground">{community.name}</span>!<br />
                  <span className="text-xs">Be the first to say something.</span>
                </p>
              </div>
            )}

            {grouped.map((group) => (
              <div key={group.date}>
                {/* Date divider */}
                <div className="flex items-center justify-center py-3">
                  <span className="font-body text-[11px] text-foreground-muted bg-surface-raised rounded-full px-3 py-0.5 shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
                    {group.date}
                  </span>
                </div>

                {group.messages.map((msg, i) => {
                  const isMe = msg.user_id === currentUserId;
                  const prev = group.messages[i - 1];
                  const isSameAuthor = prev?.user_id === msg.user_id;
                  const sender = msg.users;

                  if (isMe) {
                    return (
                      <div key={msg.id} className={`flex justify-end ${isSameAuthor ? "mt-0.5" : "mt-3"}`}>
                        <div className="max-w-[65%]">
                          <div className={`rounded-2xl rounded-tr-sm px-3 py-2 transition-opacity ${
                            msg.status === "sending" ? "bg-accent opacity-70" :
                            msg.status === "failed"  ? "bg-red-500/80" :
                            "bg-accent"
                          }`}>
                            <p className="font-body text-sm text-accent-foreground whitespace-pre-wrap break-words">{msg.content}</p>
                          </div>
                          <div className="flex items-center justify-end gap-1 mt-0.5 pr-1">
                            <span className="font-mono text-[10px] text-foreground-muted">
                              {fmtTime(msg.created_at)}
                            </span>
                            {msg.status === "sending" && (
                              <Clock size={10} className="text-foreground-muted animate-pulse" />
                            )}
                            {(msg.status === "sent" || !msg.status) && (
                              <CheckCheck size={11} className="text-accent" />
                            )}
                            {msg.status === "failed" && (
                              <span className="text-[10px] text-red-400">!</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className={`flex items-start gap-2 ${isSameAuthor ? "mt-0.5" : "mt-3"}`}>
                      {/* Avatar — only for first in a run */}
                      <div className="w-7 shrink-0">
                        {!isSameAuthor && sender && (
                          <Avatar name={sender.name} url={sender.avatar_url} size={7} />
                        )}
                      </div>
                      <div className="max-w-[65%]">
                        {!isSameAuthor && sender && (
                          <p className="font-body text-[11px] font-medium text-foreground-muted mb-0.5 ml-0.5">
                            {sender.name}
                          </p>
                        )}
                        <div className="rounded-2xl rounded-tl-sm bg-surface-raised shadow-sm px-3 py-2">
                          <p className="font-body text-sm text-foreground whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                        <p className="font-mono text-[10px] text-foreground-muted mt-0.5 ml-0.5">
                          {fmtTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Floating Input */}
          <div className="px-4 pb-4 pt-2 shrink-0">
            {error && (
              <p className="font-body text-xs text-red-400 mb-2 pl-1">{error}</p>
            )}
            <div className="flex items-end gap-2 bg-surface-raised rounded-2xl shadow-md px-4 py-3 min-h-[52px]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Auto-resize: reset height first so shrinking works
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${community.name}…`}
                rows={1}
                className="flex-1 resize-none bg-transparent font-body text-sm text-foreground placeholder:text-foreground-muted outline-none overflow-y-auto"
                style={{ lineHeight: "1.5", height: "24px", maxHeight: "120px" }}
              />
              {input.trim() && (
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Send"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[15px] h-[15px]" style={{ marginLeft: "1px" }}>
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Members panel — always visible */}
        <div className="w-56 shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border relative" ref={membersDropdownRef}>
            {/* Clickable Members title with chevron */}
            <button
              onClick={() => setShowMembersDropdown((v) => !v)}
              className="flex items-center gap-1.5 group"
            >
              <span className="font-body text-sm font-medium text-foreground-muted group-hover:text-foreground transition-colors">
                Members
              </span>
              <ChevronDown
                size={14}
                className={`text-foreground-muted group-hover:text-foreground transition-transform duration-200 ${showMembersDropdown ? "rotate-180" : ""}`}
              />
            </button>

            {/* Dropdown */}
            {showMembersDropdown && (
              <div className="absolute left-4 top-full mt-1 z-50 w-40 rounded-lg border border-border bg-surface shadow-lg py-1 overflow-hidden">
                <button
                  className="w-full text-left px-4 py-2.5 font-body text-sm text-foreground hover:bg-surface-raised transition-colors"
                  onClick={() => setShowMembersDropdown(false)}
                >
                  Topics
                </button>
                <button
                  className="w-full text-left px-4 py-2.5 font-body text-sm text-foreground hover:bg-surface-raised transition-colors"
                  onClick={() => setShowMembersDropdown(false)}
                >
                  Settings
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 py-1.5">
                <Avatar name={m.users?.name ?? "?"} url={m.users?.avatar_url ?? null} size={7} />
                <span className="font-body text-xs text-foreground truncate">{m.users?.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
