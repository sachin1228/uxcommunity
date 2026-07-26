"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Calendar, CornerDownRight, ExternalLink, Image as ImageIcon,
  Loader2, MapPin, MessageSquare, MoreHorizontal, Pencil,
  Smile, Trash2, Users, Video, X,
} from "lucide-react";
import type { CommunityEvent, EventComment, EventRsvp } from "./types";
import { EditEventModal } from "./EditEventModal";
import { EmojiGifPicker } from "@/components/communities/chat/EmojiGifPicker";

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

/** Build a comment tree from a flat array. */
function buildTree(flat: EventComment[]): EventComment[] {
  const map = new Map<string, EventComment>();
  const roots: EventComment[] = [];
  flat.forEach((c) => map.set(c.id, { ...c, replies: [] }));
  map.forEach((c) => {
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.replies!.push(c);
    } else {
      roots.push(c);
    }
  });
  return roots;
}

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
  currentUserName: string;
  currentUserAvatar: string | null;
  communityId: string;
  eventId: string;
  depth?: number;
  onDelete: (id: string) => Promise<void>;
  onReplyPosted: (comment: EventComment) => void;
}

function CommentNode({
  comment,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  communityId,
  eventId,
  depth = 0,
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
    try { await onDelete(comment.id); } finally { setDeleting(false); }
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

  // Cap visual indent at 4 levels
  const indentPx = Math.min(depth, 4) * 28;

  return (
    <div style={{ paddingLeft: indentPx }}>
      {/* Thread connector line for replies */}
      {depth > 0 && (
        <div className="flex items-start gap-2 mb-1">
          <CornerDownRight size={12} className="mt-0.5 text-foreground-subtle/40 shrink-0" />
        </div>
      )}

      <div className="group flex gap-3">
        <Avatar name={comment.users?.name ?? "M"} avatarUrl={comment.users?.avatar_url ?? null} size={depth > 0 ? "sm" : "md"} />
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2">
            <span className="font-body text-sm font-semibold text-foreground">
              {comment.users?.name ?? "Member"}
            </span>
            <span className="font-body text-[11px] text-foreground-subtle flex-1">
              {fmtRelative(comment.created_at)}
            </span>

            {/* ⋯ menu — own comments only */}
            {isOwn && (
              <div ref={menuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setMenuOpen((p) => !p)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-raised hover:text-foreground focus:opacity-100"
                  aria-label="Comment options"
                >
                  <MoreHorizontal size={13} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-7 z-30 min-w-[120px] rounded-lg border border-border bg-surface py-1 shadow-lg">
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

          {/* Reply button */}
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => { setReplyOpen((p) => !p); setReplyError(null); }}
              className="font-body text-[11px] font-medium text-foreground-subtle transition-colors hover:text-accent"
            >
              Reply
            </button>
          </div>

          {/* Inline reply composer */}
          {replyOpen && (
            <form onSubmit={handleReply} className="mt-2 flex gap-2">
              <Avatar name={currentUserName || "M"} avatarUrl={currentUserAvatar} size="sm" />
              <div className="flex-1 min-w-0 rounded-xl border border-border bg-surface-raised px-3 py-2">
                <textarea
                  ref={replyRef}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleReply();
                    if (e.key === "Escape") { setReplyOpen(false); setReplyText(""); }
                  }}
                  placeholder={`Reply to ${comment.users?.name ?? "this comment"}…`}
                  rows={2}
                  maxLength={2000}
                  className="w-full resize-none bg-transparent font-body text-xs text-foreground placeholder:text-foreground-subtle focus:outline-none"
                />
                {replyError && <p className="mt-1 font-body text-[11px] text-red-400">{replyError}</p>}
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setReplyOpen(false); setReplyText(""); setReplyError(null); }}
                    className="font-body text-[11px] text-foreground-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!replyText.trim() || replyPosting}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1 font-body text-[11px] font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {replyPosting ? <Loader2 size={10} className="animate-spin" /> : null}
                    {replyPosting ? "Posting…" : "Reply"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Children (recursive) */}
      {(comment.replies?.length ?? 0) > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies!.map((child) => (
            <CommentNode
              key={child.id}
              comment={child}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatar={currentUserAvatar}
              communityId={communityId}
              eventId={eventId}
              depth={depth + 1}
              onDelete={onDelete}
              onReplyPosted={onReplyPosted}
            />
          ))}
        </div>
      )}
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
}

export function EventDetailClient({
  event: initialEvent,
  initialRsvps,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  communityId,
  communityName,
}: Props) {
  const router = useRouter();
  const [event, setEvent] = useState(initialEvent);
  const [rsvps, setRsvps] = useState<EventRsvp[]>(initialRsvps);
  const [rsvpPending, setRsvpPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [activeTab, setActiveTab] = useState<"discussion" | "attendees">("discussion");

  // Comments (flat list, built into tree on render)
  const [comments, setComments] = useState<EventComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);

  // Main composer state
  const [expanded, setExpanded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!emojiOpen) return;
    function outside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) setEmojiOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [emojiOpen]);

  const isOwner = event.user_id === currentUserId;
  const past = isPast(event.end_date ?? event.event_date);
  const full = event.max_attendees !== null && event.rsvp_count >= event.max_attendees && !event.user_rsvped;

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}/comments`);
      if (res.ok) { const d = await res.json(); setComments(d.comments ?? []); }
    } finally { setCommentsLoading(false); }
  }, [communityId, event.id]);

  useEffect(() => { void fetchComments(); }, [fetchComments]);

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
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

  // ── Composer ──

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setExpanded(true);
    e.target.value = "";
  }

  function clearImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
  }

  function handleEmojiInsert(emoji: string) {
    const ta = textareaRef.current;
    if (!ta) { setCommentText((p) => p + emoji); return; }
    const start = ta.selectionStart ?? commentText.length;
    const end = ta.selectionEnd ?? commentText.length;
    const next = commentText.slice(0, start) + emoji + commentText.slice(end);
    setCommentText(next);
    setEmojiOpen(false);
    setTimeout(() => { ta.focus(); const pos = start + emoji.length; ta.setSelectionRange(pos, pos); }, 0);
  }

  function handleComposerClick() {
    setExpanded(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function handlePostComment(e?: React.FormEvent) {
    e?.preventDefault();
    const text = commentText.trim();
    if ((!text && !imageFile) || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      let uploadedImageUrl: string | null = null;
      if (imageFile) {
        const form = new FormData();
        form.append("file", imageFile);
        const uploadRes = await fetch(`/api/communities/${communityId}/events/upload`, { method: "POST", body: form });
        if (!uploadRes.ok) { const d = await uploadRes.json(); setCommentError(d.error ?? "Image upload failed."); return; }
        const { url } = await uploadRes.json();
        uploadedImageUrl = url;
      }
      const res = await fetch(`/api/communities/${communityId}/events/${event.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, image_url: uploadedImageUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setCommentError(data.error ?? "Failed to post."); return; }
      setComments((prev) => [...prev, data.comment]);
      setCommentText("");
      clearImage();
      setExpanded(false);
    } finally { setPosting(false); }
  }

  function handleCancel() {
    setCommentText("");
    clearImage();
    setExpanded(false);
    setCommentError(null);
  }

  // ── Comment actions passed to CommentNode ──

  const handleDeleteComment = useCallback(async (commentId: string) => {
    const res = await fetch(`/api/communities/${communityId}/events/${event.id}/comments/${commentId}`, { method: "DELETE" });
    if (res.ok) setComments((prev) => prev.filter((c) => c.id !== commentId));
  }, [communityId, event.id]);

  const handleReplyPosted = useCallback((comment: EventComment) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  // ── Build tree ──
  const commentTree = buildTree(comments);
  const topLevelCount = comments.filter((c) => !c.parent_id).length;

  // Gradient placeholder
  const gradients = [
    "from-violet-500/80 to-pink-500/80",
    "from-blue-500/80 to-cyan-400/80",
    "from-orange-400/80 to-rose-500/80",
    "from-emerald-400/80 to-teal-500/80",
  ];
  const gradientIndex = event.id.charCodeAt(0) % gradients.length;
  const canPost = (commentText.trim().length > 0 || imageFile !== null) && !posting;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {/* Back link */}
        <Link
          href={`/dashboard/communities/${communityId}`}
          className="mb-5 inline-flex items-center gap-1.5 font-body text-xs text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft size={13} /> Back to {communityName}
        </Link>

        {/* Main event card — horizontal */}
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex min-h-[200px]">
            <div className="relative w-56 shrink-0 overflow-hidden">
              {event.cover_image_url
                ? <img src={event.cover_image_url} alt={event.title} className="h-full w-full object-cover" />
                : <div className={`h-full w-full bg-gradient-to-br ${gradients[gradientIndex]}`} />}
            </div>

            <div className="flex flex-1 flex-col gap-3 px-6 py-5 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-body text-[11px] font-medium ${
                  past ? "border-border text-foreground-subtle" : "border-accent/50 text-accent"
                }`}>
                  {past ? "Past Event" : "Upcoming Event"}
                </span>

                <div className="flex shrink-0 items-center gap-2">
                  {!past && (
                    <button
                      type="button"
                      onClick={handleJoin}
                      disabled={rsvpPending || (full && !event.user_rsvped)}
                      className={`rounded-lg px-4 py-1.5 font-body text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
                  <button type="button" onClick={handleShare}
                    className="rounded-lg border border-border px-4 py-1.5 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground">
                    {shared ? "Copied!" : "Share"}
                  </button>
                  {isOwner && (
                    <div className="relative">
                      <button type="button" onClick={() => setMenuOpen((p) => !p)} aria-label="Event options"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground">
                        <MoreHorizontal size={15} />
                      </button>
                      {menuOpen && (
                        <div className="absolute right-0 top-9 z-20 min-w-[140px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                          <button type="button" onClick={() => { setMenuOpen(false); setShowEditModal(true); }}
                            className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
                            <Pencil size={12} /> Edit event
                          </button>
                          <button type="button" onClick={handleDeleteEvent} disabled={deleting}
                            className="flex w-full items-center gap-2 px-3 py-2 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50">
                            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            {deleting ? "Deleting…" : "Delete event"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <h1 className="font-display text-2xl font-bold leading-tight text-foreground">{event.title}</h1>

              {event.description && (
                <p className="font-body text-sm leading-relaxed text-foreground-muted">{event.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                <span className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted">
                  <Calendar size={13} className="shrink-0 text-accent" />
                  {fmtEventDateTime(event.event_date)}
                  {event.end_date && ` – ${fmtTime(event.end_date)}`}
                </span>
                {event.is_online ? (
                  <span className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted">
                    <Video size={13} className="shrink-0" />
                    {event.meet_link
                      ? <a href={event.meet_link} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline">
                          Online (Google Meet) <ExternalLink size={10} />
                        </a>
                      : "Online"}
                  </span>
                ) : event.location ? (
                  <span className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted">
                    <MapPin size={13} className="shrink-0" />
                    {event.location}
                  </span>
                ) : null}
              </div>

              <p className="font-body text-sm text-foreground-muted">
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

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="mt-6">
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
                  <span className="rounded-full bg-surface-raised px-1.5 py-0.5 font-body text-[10px] text-foreground-subtle">
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
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                {!expanded ? (
                  <button type="button" onClick={handleComposerClick}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                    <Avatar name={currentUserName || "M"} avatarUrl={currentUserAvatar} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-foreground">Start a discussion</p>
                      <p className="font-body text-xs text-foreground-subtle">Ask a question or share something about this event…</p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-accent px-3.5 py-1.5 font-body text-xs font-semibold text-accent-foreground">
                      Add comment
                    </span>
                  </button>
                ) : (
                  <form onSubmit={handlePostComment} className="p-4 space-y-3">
                    <div className="flex gap-3">
                      <Avatar name={currentUserName || "M"} avatarUrl={currentUserAvatar} size="md" />
                      <div className="flex-1 min-w-0">
                        <textarea
                          ref={textareaRef}
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handlePostComment();
                            if (e.key === "Escape") handleCancel();
                          }}
                          placeholder="Ask a question or share something about this event…"
                          rows={3}
                          maxLength={2000}
                          autoFocus
                          className="w-full resize-none bg-transparent font-body text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
                        />
                        {imagePreview && (
                          <div className="relative mt-2 inline-block">
                            <img src={imagePreview} alt="Upload preview" className="max-h-48 rounded-lg border border-border object-cover" />
                            <button type="button" onClick={clearImage}
                              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-surface border border-border text-foreground-muted hover:text-foreground">
                              <X size={10} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {commentError && <p className="pl-11 font-body text-xs text-red-400">{commentError}</p>}

                    <div className="flex items-center justify-between pl-11">
                      <div className="flex items-center gap-1">
                        <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                          className="hidden" onChange={handleImageSelect} />

                        {/* Emoji */}
                        <div ref={emojiPickerRef} className="relative">
                          <button type="button" onClick={() => setEmojiOpen((p) => !p)} title="Add emoji"
                            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-raised ${
                              emojiOpen ? "text-accent" : "text-foreground-subtle hover:text-foreground"
                            }`}>
                            <Smile size={16} />
                          </button>
                          {emojiOpen && (
                            <div className="absolute bottom-full left-0 mb-2 z-50">
                              <EmojiGifPicker onEmojiSelect={handleEmojiInsert} onGifSelect={() => setEmojiOpen(false)} />
                            </div>
                          )}
                        </div>

                        {/* GIF — coming soon */}
                        <div className="relative group/gif">
                          <button type="button" disabled
                            className="flex h-8 items-center justify-center rounded-lg px-2 font-body text-[11px] font-black tracking-wide text-foreground-subtle opacity-40 cursor-not-allowed">
                            GIF
                          </button>
                          <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1 font-body text-[11px] text-foreground-muted shadow-md opacity-0 transition-opacity group-hover/gif:opacity-100">
                            Coming soon
                          </div>
                        </div>

                        {/* Image */}
                        <button type="button" onClick={() => imageInputRef.current?.click()} title="Add image"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground">
                          <ImageIcon size={16} />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button type="button" onClick={handleCancel}
                          className="rounded-lg px-3.5 py-1.5 font-body text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground">
                          Cancel
                        </button>
                        <button type="submit" disabled={!canPost}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 font-body text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">
                          {posting ? <Loader2 size={12} className="animate-spin" /> : null}
                          {posting ? "Posting…" : "Post"}
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>

              {/* Comments list */}
              {commentsLoading ? (
                <div className="space-y-4 animate-pulse">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex gap-3">
                      <div className="h-8 w-8 rounded-full bg-surface-raised shrink-0" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="h-3 w-24 rounded bg-surface-raised" />
                        <div className="h-4 w-full rounded bg-surface-raised" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : commentTree.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <MessageSquare size={22} className="mx-auto text-foreground-subtle" />
                  <p className="mt-2 font-body text-sm text-foreground-muted">No comments yet. Be the first to start the discussion!</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {commentTree.map((c) => (
                    <CommentNode
                      key={c.id}
                      comment={c}
                      currentUserId={currentUserId}
                      currentUserName={currentUserName}
                      currentUserAvatar={currentUserAvatar}
                      communityId={communityId}
                      eventId={event.id}
                      depth={0}
                      onDelete={handleDeleteComment}
                      onReplyPosted={handleReplyPosted}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Attendees tab ──────────────────────────────────── */}
          {activeTab === "attendees" && (
            <div className="mt-5">
              {rsvps.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <Users size={22} className="mx-auto text-foreground-subtle" />
                  <p className="mt-2 font-body text-sm text-foreground-muted">No attendees yet. Be the first to join!</p>
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
