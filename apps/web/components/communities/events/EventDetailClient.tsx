"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  CornerDownRight, Loader2, MessageSquare, MoreHorizontal,
  Send, Trash2, Users,
} from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import { Spinner } from "@/components/ui/Spinner";
import type { CommunityEvent, EventComment, EventRsvp } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { fetchJsonCached, getCachedRequest, setCachedRequest } from "@/lib/request-cache";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { EventCard } from "./EventCard";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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
      const res = await dedupeFetch(
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
      const res = await dedupeFetch(`/api/communities/${communityId}/events/${eventId}/comments`, {
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
  const router = useGuardedRouter();
  const [event, setEvent] = useState(initialEvent);
  const [rsvps, setRsvps] = useState<EventRsvp[]>(initialRsvps);
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

  const handleLikeChanged = useCallback((eventId: string, liked: boolean, count: number) => {
    setEvent((current) => current.id === eventId
      ? { ...current, user_liked: liked, like_count: count }
      : current);
  }, []);

  const handleSaveChanged = useCallback((eventId: string, saved: boolean, count: number) => {
    setEvent((current) => current.id === eventId
      ? { ...current, user_saved: saved, save_count: count }
      : current);
  }, []);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [commentText]);

  // ── Composer ──

  async function handlePostComment(e?: React.FormEvent) {
    e?.preventDefault();
    const text = commentText.trim();
    if (!text || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/events/${event.id}/comments`, {
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

  const canPost = commentText.trim().length > 0 && !posting;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`${communityFeedLayout.detailContent} ${communityFeedLayout.detailPage}`}>
        {/* ── Back link (homepage context only) ── */}
        {backHref && (
          <BackLink
            href={backHref}
            label={backLabel}
            className={`mb-5 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground ${communityFeedLayout.detailSection}`}
          />
        )}
        {/* Event post */}
        <section className={`${communityFeedLayout.dividerBottom} py-6`}>
          <div className={communityFeedLayout.detailSection}>
            <EventCard
              variant="detail"
              event={event}
              currentUserId={currentUserId}
              communityId={communityId}
              rsvps={rsvps}
              communityName={showCommunityAttribution ? communityName : undefined}
              communityImage={communityImage}
              onUpdated={setEvent}
              onDeleted={() => router.push(`/dashboard/communities/${communityId}`)}
              onRsvpChanged={(_, rsvped, count) => setEvent((current) => ({ ...current, user_rsvped: rsvped, rsvp_count: count }))}
              onRsvpSettled={async () => {
                const response = await fetch(`/api/communities/${communityId}/events/${event.id}/rsvp/list`);
                if (response.ok) {
                  const data = await response.json();
                  setRsvps(data.rsvps ?? []);
                }
              }}
              onLikeChanged={handleLikeChanged}
              onSaveChanged={handleSaveChanged}
            />
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
                <div className="flex items-center justify-center border-t border-border py-12">
                  <Spinner size={22} className="text-foreground-muted" />
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

    </div>
  );
}
