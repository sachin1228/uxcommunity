"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Calendar, CornerDownRight, ExternalLink,
  Heart, Loader2, MapPin, MessageSquare, MoreHorizontal, Pencil,
  Send, Share2, Trash2, Users, Video,
} from "lucide-react";
import type { CommunityEvent, EventComment, EventRsvp } from "./types";
import { EditEventModal } from "./EditEventModal";
import { communityFeedLayout } from "../feed-layout";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { createBrowserClient } from "@/lib/supabase/browser";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import {
  fetchJsonCached,
  getCachedRequest,
  setCachedRequest,
  subscribeToRequest,
} from "@/lib/request-cache";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtEventDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
  return `${date} • ${time}`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}
function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function isPast(iso: string) { return new Date(iso) < new Date(); }

// ─── Sub-components ──────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "sm" | "md" | "lg" }) {
  const initial = (name || "M").charAt(0).toUpperCase();
  const dim = size === "sm" ? "h-6 w-6 text-[9px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <div className={`${dim} shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center`}>
      {avatarUrl
        ? <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
        : <span className="font-display font-bold text-accent">{initial}</span>}
    </div>
  );
}

function AvatarStack({ rsvps, count }: { rsvps: EventRsvp[]; count: number }) {
  const visible = rsvps.slice(0, 5);
  const extra = count - visible.length;
  if (count === 0) return <span className="font-body text-sm text-foreground-subtle">0 going</span>;
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center">
        {visible.map((r, i) => (
          <div
            key={r.user_id}
            style={{ marginLeft: i === 0 ? 0 : "-8px", zIndex: 10 - i }}
            className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 border-surface bg-accent/15 flex items-center justify-center"
          >
            {r.users?.avatar_url
              ? <img src={r.users.avatar_url} alt={r.users.name} className="h-full w-full object-cover" />
              : <span className="font-display text-[10px] font-bold text-accent">{(r.users?.name ?? "M").charAt(0).toUpperCase()}</span>}
          </div>
        ))}
      </div>
      <span className="font-body text-sm text-foreground-muted">
        {extra > 0 ? `+${extra} going` : `${count} going`}
      </span>
    </div>
  );
}

// ─── CommentNode ─────────────────────────────────────────────────────────────

interface CommentNodeProps {
  comment: EventComment;
  currentUserId: string;
  communityId: string;
  eventId: string;
  isReply?: boolean;
  /** Only top-level comments show the reply composer */
  allowReply?: boolean;
  onDelete: (id: string) => void;
  onReplyPosted: (comment: EventComment) => void;
}

function CommentNode({
  comment,
  currentUserId,
  communityId,
  eventId,
  isReply = false,
  allowReply = true,
  onDelete,
  onReplyPosted,
}: CommentNodeProps) {
  const isOwn = comment.user_id === currentUserId;
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyPosting, setReplyPosting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function outside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [menuOpen]);

  useEffect(() => {
    if (replyOpen) setTimeout(() => replyRef.current?.focus(), 0);
  }, [replyOpen]);

  async function handleDelete() {
    setMenuOpen(false);
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/communities/${communityId}/events/${eventId}/comments/${comment.id}`,
        { method: "DELETE" },
      );
      if (res.ok) onDelete(comment.id);
    } finally { setDeleting(false); }
  }

  async function handleReply(e?: React.FormEvent) {
    e?.preventDefault();
    const text = replyText.trim();
    if (!text || replyPosting) return;
    setReplyPosting(true);
    setReplyError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${eventId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parent_id: comment.id }),
      });
      const data = await res.json();
      if (!res.ok) { setReplyError(data.error ?? "Failed to post reply."); return; }
      onReplyPosted(data.comment);
      setReplyText("");
      setReplyOpen(false);
    } finally { setReplyPosting(false); }
  }

  return (
    <div className={isReply ? "pl-8" : ""}>
      {isReply && (
        <div className="mb-1 flex items-center gap-1">
          <CornerDownRight size={11} className="text-foreground-subtle/40 shrink-0" />
        </div>
      )}

      <div className="group flex gap-2.5">
        <Avatar
          name={comment.users?.name ?? "M"}
          avatarUrl={comment.users?.avatar_url ?? null}
          size={isReply ? "sm" : "md"}
        />
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2">
            <span className="font-body text-xs font-semibold text-foreground">
              {comment.users?.name ?? "Member"}
            </span>
            <span className="font-body text-[11px] text-foreground-subtle">
              {fmtRelative(comment.created_at)}
            </span>

            {/* ⋯ menu — own comments only */}
            {isOwn && (
              <div ref={menuRef} className="relative ml-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setMenuOpen((p) => !p)}
                  className="flex h-5 w-5 items-center justify-center rounded text-foreground-subtle hover:text-foreground"
                  aria-label="Comment options"
                >
                  <MoreHorizontal size={13} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-6 z-30 min-w-[110px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                    >
                      {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          {comment.body && (
            <p className="mt-1 font-body text-sm text-foreground-muted leading-relaxed whitespace-pre-wrap break-words">
              {comment.body}
            </p>
          )}

          {/* Image attachment */}
          {comment.image_url && (
            <a href={comment.image_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
              <img
                src={comment.image_url}
                alt="Attachment"
                className="max-h-56 rounded-xl border border-border object-cover"
              />
            </a>
          )}

          {/* Reply button — only on top-level comments */}
          {allowReply && (
            <button
              type="button"
              onClick={() => { setReplyOpen((p) => !p); setReplyError(null); }}
              className="mt-1.5 inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle hover:text-accent"
            >
              <CornerDownRight size={11} />
              Reply
            </button>
          )}

          {/* Inline reply composer */}
          {replyOpen && (
            <div className="mt-2">
              <form onSubmit={handleReply} className="space-y-2">
                <textarea
                  ref={replyRef}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleReply();
                    if (e.key === "Escape") { setReplyOpen(false); setReplyText(""); }
                  }}
                  placeholder={`Write a reply…`}
                  rows={2}
                  maxLength={2000}
                  className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2 font-body text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
                />
                {replyError && <p className="font-body text-[11px] text-red-400">{replyError}</p>}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setReplyOpen(false); setReplyText(""); setReplyError(null); }}
                    className="font-body text-xs text-foreground-subtle hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!replyText.trim() || replyPosting}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {replyPosting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                    {replyPosting ? "Posting…" : "Post"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  event: CommunityEvent;
  initialRsvps: EventRsvp[];
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  communityId: string;
  communityName: string;
  communityImage?: string | null;
  showCommunityAttribution?: boolean;
  /** When provided, renders a back link above the event (e.g. homepage context). */
  backHref?: string;
  backLabel?: string;
}

export function EventDetailClient({
  event: initialEvent,
  initialRsvps,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  communityId,
  communityName,
  communityImage,
  showCommunityAttribution = false,
  backHref,
  backLabel = "Home",
}: Props) {
  const router = useRouter();
  const saveUrl = `/api/communities/${communityId}/events/${initialEvent.id}/save`;
  const [event, setEvent] = useState(() => {
    const cached = getCachedRequest<{ saved: boolean; save_count: number }>(saveUrl, currentUserId);
    return cached
      ? { ...initialEvent, user_saved: cached.saved, save_count: cached.save_count }
      : initialEvent;
  });
  const [rsvps, setRsvps] = useState<EventRsvp[]>(initialRsvps);
  const [rsvpPending, setRsvpPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [activeTab, setActiveTab] = useState<"discussion" | "attendees">("discussion");

  // Comments (flat list, built into tree on render)
  const commentsUrl = `/api/communities/${communityId}/events/${initialEvent.id}/comments`;
  const cachedComments = getCachedRequest<{ comments?: EventComment[] }>(commentsUrl, currentUserId);
  const [comments, setComments] = useState<EventComment[]>(cachedComments?.comments ?? []);
  const [commentsLoading, setCommentsLoading] = useState(!cachedComments);

  // Main composer state
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveCoordinatorRef = useRef<BooleanIntentCoalescer | null>(null);

  const isOwner = event.user_id === currentUserId;
  const past = isPast(event.end_date ?? event.event_date);
  const full = event.max_attendees !== null && event.rsvp_count >= event.max_attendees && !event.user_rsvped;

  const fetchComments = useCallback(async () => {
    try {
      const data = await fetchJsonCached<{ comments?: EventComment[] }>(
        commentsUrl,
        { staleMs: 15_000 },
        currentUserId,
      );
      setComments(data.comments ?? []);
    } finally { setCommentsLoading(false); }
  }, [commentsUrl, currentUserId]);

  useEffect(() => { void fetchComments(); }, [fetchComments]);
  useEffect(() => {
    setCachedRequest(commentsUrl, { comments }, currentUserId);
  }, [comments, commentsUrl, currentUserId]);

  type SaveState = { saved: boolean; save_count: number };

  const applySaveState = useCallback((data: SaveState) => {
    setEvent((current) => ({
      ...current,
      user_saved: data.saved,
      save_count: data.save_count,
    }));
    saveCoordinatorRef.current?.syncConfirmed(data.saved);
  }, []);

  const fetchSaveState = useCallback(async (force = false) => {
    try {
      const data = await fetchJsonCached<SaveState>(
        saveUrl,
        { force, staleMs: 60_000 },
        currentUserId,
      );
      applySaveState(data);
    } catch {
      // Keep the server-rendered state when reconciliation is temporarily unavailable.
    }
  }, [applySaveState, currentUserId, saveUrl]);

  useEffect(() => {
    if (!getCachedRequest<SaveState>(saveUrl, currentUserId)) {
      setCachedRequest(saveUrl, {
        saved: initialEvent.user_saved,
        save_count: initialEvent.save_count,
      }, currentUserId);
    }

    return subscribeToRequest(saveUrl, () => {
      const next = getCachedRequest<SaveState>(saveUrl, currentUserId);
      if (next) applySaveState(next);
    }, currentUserId);
  }, [applySaveState, currentUserId, initialEvent.save_count, initialEvent.user_saved, saveUrl]);

  useEffect(() => {
    queueMicrotask(() => void fetchSaveState());
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

    const channel = supabase
      .channel(`event-save-detail:${event.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "event_saves",
        filter: `event_id=eq.${event.id}`,
      }, () => void fetchSaveState(true))
      .subscribe();

    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void fetchSaveState(true);
    };
    document.addEventListener("visibilitychange", refreshOnFocus);
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [event.id, fetchSaveState]);

  useEffect(() => {
    const coordinator = new BooleanIntentCoalescer({
      initialValue: initialEvent.user_saved,
      onOptimisticChange: (saved) => {
        setEvent((current) => ({
          ...current,
          user_saved: saved,
          save_count: Math.max(0, current.save_count + (saved === current.user_saved ? 0 : saved ? 1 : -1)),
        }));
      },
      persist: async (desired) => {
        const response = await fetch(saveUrl, { method: "POST" });
        const data = await response.json().catch(() => null) as SaveState | null;
        if (!response.ok || !data) throw new Error("Unable to update like");
        setCachedRequest(saveUrl, data, currentUserId);
        if (data.saved !== desired) throw new Error("Save state did not match the latest intent");
        return data.saved;
      },
    });
    saveCoordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      saveCoordinatorRef.current = null;
    };
  }, [currentUserId, initialEvent.user_saved, saveUrl]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [commentText]);

  // ── Event actions ──

  async function handleJoin() {
    if (rsvpPending || past) return;
    setRsvpPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}/rsvp`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to RSVP."); return; }
      setEvent((e) => ({ ...e, user_rsvped: data.rsvped, rsvp_count: data.rsvp_count }));
      const listRes = await fetch(`/api/communities/${communityId}/events/${event.id}/rsvp/list`);
      if (listRes.ok) { const d = await listRes.json(); setRsvps(d.rsvps ?? []); }
    } finally { setRsvpPending(false); }
  }

  async function handleDeleteEvent() {
    if (!confirm("Delete this event? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}`, { method: "DELETE" });
      if (res.ok) router.push(`/dashboard/communities/${communityId}`);
    } finally { setDeleting(false); }
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: event.title, url }); } catch { /* dismissed */ }
    } else {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  }

  function handleSave() {
    saveCoordinatorRef.current?.toggle();
  }

  // ── Composer ──

  async function handlePostComment(e?: React.FormEvent) {
    e?.preventDefault();
    const text = commentText.trim();
    if (!text || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (!res.ok) { setCommentError(data.error ?? "Failed to post."); return; }
      setComments((prev) => [...prev, data.comment]);
      setCommentText("");
    } finally { setPosting(false); }
  }

  // ── Comment actions passed to CommentNode ──

  const handleDeleteComment = useCallback((commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }, []);

  const handleReplyPosted = useCallback((comment: EventComment) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  // ── Flat lists for rendering (ThreadDetailClient-style) ──
  const rootComments = comments.filter((c) => !c.parent_id);
  const totalCommentCount = comments.length;
  const topLevelCount = rootComments.length;

  // Gradient placeholder
  const gradients = [
    "from-violet-500/80 to-pink-500/80",
    "from-blue-500/80 to-cyan-400/80",
    "from-orange-400/80 to-rose-500/80",
    "from-emerald-400/80 to-teal-500/80",
  ];
  const gradientIndex = event.id.charCodeAt(0) % gradients.length;
  const canPost = commentText.trim().length > 0 && !posting;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`${communityFeedLayout.detailContent} ${communityFeedLayout.detailPage}`}>
        {/* ── Back link (homepage context only) ── */}
        {backHref && (
          <a
            href={backHref}
            className={`mb-5 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground ${communityFeedLayout.detailSection}`}
          >
            <ArrowLeft size={14} />
            {backLabel}
          </a>
        )}
        {/* Event post — follows the shared thread/resource detail layout */}
        <section className={`${communityFeedLayout.dividerY} py-6`}>
          <div className={communityFeedLayout.detailSection}>
        {/* Feed-style author header */}
        <div className="relative mb-4 flex items-center gap-3">
          <Avatar
            name={event.users?.name ?? "Community member"}
            avatarUrl={event.users?.avatar_url ?? null}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-display text-base font-semibold text-foreground">
                {event.users?.name ?? "Community member"}
              </span>
              <span className="shrink-0 font-body text-xs text-foreground-subtle">
                {fmtRelative(event.created_at)}
              </span>
            </div>
            <p className="truncate font-body text-xs text-foreground-muted">
              Event · {event.is_online ? "Online" : event.location ?? communityName}
            </p>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Event options"
              className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 min-w-[150px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => { void handleShare(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                >
                  <Share2 size={12} /> {shared ? "Copied!" : "Share event"}
                </button>
                {isOwner && (
                  <>
                    <button type="button" onClick={() => { setMenuOpen(false); setShowEditModal(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
                      <Pencil size={12} /> Edit event
                    </button>
                    <button type="button" onClick={handleDeleteEvent} disabled={deleting}
                      className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50">
                      {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      {deleting ? "Deleting…" : "Delete event"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Main event card — matches the homepage card */}
        <div>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex min-h-[190px] flex-col sm:flex-row">
            <div className="relative aspect-video w-full shrink-0 overflow-hidden sm:aspect-auto sm:w-44">
              {event.cover_image_url
                ? <img src={event.cover_image_url} alt={event.title} className="h-full w-full object-cover" />
                : <div className={`h-full w-full bg-gradient-to-br ${gradients[gradientIndex]}`} />}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-body text-[10px] font-medium ${
                  past ? "border-border text-foreground-subtle" : "border-accent/50 text-accent"
                }`}>
                  {past ? "Past Event" : "Upcoming Event"}
                </span>

                <div className="flex shrink-0 items-center gap-1.5">
                  {!past && (
                    <button
                      type="button"
                      onClick={handleJoin}
                      disabled={rsvpPending || (full && !event.user_rsvped)}
                      className={`rounded-md px-3 py-1 font-body text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        event.user_rsvped
                          ? "bg-accent/15 text-accent hover:bg-accent/25"
                          : full
                          ? "border border-border text-foreground-subtle"
                          : "bg-accent text-accent-foreground hover:bg-accent-hover"
                      }`}
                    >
                      {rsvpPending ? "Updating…" : event.user_rsvped ? "Going ✓" : full ? "Event Full" : "Join Event"}
                    </button>
                  )}

                </div>
              </div>

              <h1 className="font-display text-lg font-bold leading-tight text-foreground">{event.title}</h1>

              {event.description && (
                <p className="font-body text-xs leading-relaxed text-foreground-muted">{event.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1 font-body text-xs text-foreground-muted">
                  <Calendar size={12} className="shrink-0 text-accent" />
                  {fmtEventDateTime(event.event_date)}
                  {event.end_date && ` – ${fmtTime(event.end_date)}`}
                </span>
                {event.is_online ? (
                  <span className="inline-flex items-center gap-1 font-body text-xs text-foreground-muted">
                    <Video size={12} className="shrink-0" />
                    {event.meet_link
                      ? <a href={event.meet_link} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline">
                          Online (Google Meet) <ExternalLink size={10} />
                        </a>
                      : "Online"}
                  </span>
                ) : event.location ? (
                  <span className="inline-flex items-center gap-1 font-body text-xs text-foreground-muted">
                    <MapPin size={12} className="shrink-0" />
                    {event.location}
                  </span>
                ) : null}
              </div>

              <p className="font-body text-xs text-foreground-muted">
                Hosted by <span className="font-semibold text-foreground">{event.users?.name ?? "Community member"}</span>
              </p>

              <AvatarStack rsvps={rsvps} count={event.rsvp_count} />

              {event.max_attendees && (
                <p className="font-body text-xs text-foreground-subtle">
                  {event.max_attendees - event.rsvp_count > 0
                    ? `${event.max_attendees - event.rsvp_count} spots remaining`
                    : "No spots remaining"}
                </p>
              )}
              {error && <p className="font-body text-xs text-red-400">{error}</p>}
            </div>
          </div>
          </div>
        </div>

        {/* Engagement and community metadata — same hierarchy as the homepage */}
        <div className="mt-3 flex items-center justify-between gap-4">
          <button
            type="button"
              onClick={handleSave}
              aria-label={event.user_saved ? "Unlike" : "Like"}
              aria-pressed={event.user_saved}
              className="group/like flex shrink-0 items-center gap-2"

          >
            <Heart
              size={20}
              strokeWidth={2}
              className={`transition-transform duration-150 group-hover/like:scale-110 ${
                event.user_saved ? "fill-red-500 text-red-500" : "fill-none text-foreground"
              }`}
            />
            <span className={`font-body text-sm font-semibold tabular-nums ${event.user_saved ? "text-red-500" : "text-foreground"}`}>
              {event.save_count}
            </span>
          </button>
          {showCommunityAttribution && (
            <CommunityPostLabel
              communityName={communityName}
              communityImage={communityImage}
              className="min-w-0 justify-end text-right"
            />
          )}
        </div>
          </div>
        </section>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className={`mt-6 ${communityFeedLayout.detailSection}`}>
          <div className="flex border-b border-border">
            {([
              { id: "discussion" as const, label: "Discussion", icon: <MessageSquare size={14} />, count: topLevelCount },
              { id: "attendees" as const, label: "Attendees", icon: <Users size={14} />, count: event.rsvp_count },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 pb-3 font-body text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? "border-accent text-foreground"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.count > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-surface-raised min-w-[1.25rem] h-5 px-1.5 font-body text-[10px] leading-none text-foreground-subtle">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Discussion tab ──────────────────────────────────── */}
          {activeTab === "discussion" && (
            <div className="mt-5 space-y-5">
              {/* Composer */}
              <form onSubmit={handlePostComment} className="space-y-2">
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  <textarea
                    ref={textareaRef}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handlePostComment();
                    }}
                    placeholder="Write a comment… (⌘↵ to post)"
                    rows={3}
                    maxLength={2000}
                    className="w-full resize-none bg-transparent px-4 py-3.5 font-body text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
                  />
                </div>
                {commentError && <p className="font-body text-xs text-red-400">{commentError}</p>}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!canPost}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 font-body text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {posting ? "Posting…" : "Post"}
                  </button>
                </div>
              </form>

              {/* Comments heading */}
              {!commentsLoading && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="font-display text-sm font-semibold text-foreground">
                    {totalCommentCount} {totalCommentCount === 1 ? "Comment" : "Comments"}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}

              {/* Comments list */}
              {commentsLoading ? (
                <div className="animate-pulse border-t border-border">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex gap-3 border-b border-border py-5">
                      <div className="h-8 w-8 rounded-full bg-surface-raised shrink-0" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="h-3 w-24 rounded bg-surface-raised" />
                        <div className="h-4 w-full rounded bg-surface-raised" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : rootComments.length === 0 ? (
                <div className={`${communityFeedLayout.emptyState} min-h-40`}>
                  <MessageSquare size={22} className={communityFeedLayout.emptyIcon} />
                  <p className={communityFeedLayout.emptyDescription}>No comments yet. Be the first to start the discussion!</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {rootComments.map((root) => {
                    const replies = comments.filter((c) => c.parent_id === root.id);
                    return (
                      <div key={root.id} className="space-y-3">
                        <CommentNode
                          comment={root}
                          currentUserId={currentUserId}
                          communityId={communityId}
                          eventId={event.id}
                          allowReply
                          onDelete={handleDeleteComment}
                          onReplyPosted={handleReplyPosted}
                        />
                        {replies.map((reply) => (
                          <CommentNode
                            key={reply.id}
                            comment={reply}
                            currentUserId={currentUserId}
                            communityId={communityId}
                            eventId={event.id}
                            isReply
                            allowReply={false}
                            onDelete={handleDeleteComment}
                            onReplyPosted={handleReplyPosted}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Attendees tab ──────────────────────────────────── */}
          {activeTab === "attendees" && (
            <div className="mt-5">
              {rsvps.length === 0 ? (
                <div className={`${communityFeedLayout.emptyState} min-h-40`}>
                  <Users size={22} className={communityFeedLayout.emptyIcon} />
                  <p className={communityFeedLayout.emptyDescription}>No attendees yet. Be the first to join!</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {rsvps.map((r) => (
                    <div key={r.user_id} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5">
                      <Avatar name={r.users?.name ?? "M"} avatarUrl={r.users?.avatar_url ?? null} size="sm" />
                      <span className="truncate font-body text-xs text-foreground">{r.users?.name ?? "Member"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showEditModal && (
        <EditEventModal
          event={event}
          communityId={communityId}
          onClose={() => setShowEditModal(false)}
          onUpdated={(updated) => { setEvent(updated); setShowEditModal(false); }}
        />
      )}
    </div>
  );
}
