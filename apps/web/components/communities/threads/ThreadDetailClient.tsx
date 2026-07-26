"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ChevronUp, CornerDownRight, Link as LinkIcon,
  Loader2, MessageSquare, MoreHorizontal, Paperclip, Pencil, Send, Trash2,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { CategoryIcon } from "./categoryIcons";
import type { CommunityThread, ThreadComment } from "./types";
import { THREAD_CATEGORIES } from "./types";
import { EditThreadModal } from "./EditThreadModal";

function formatRelativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatFullDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "sm" | "md" }) {
  const initial = name.charAt(0).toUpperCase();
  const dim = size === "sm" ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-xs";
  return (
    <div className={`${dim} shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="font-display font-bold text-accent">{initial}</span>
      )}
    </div>
  );
}

// ── Comment Box ──────────────────────────────────────────────────────────────

function CommentBox({
  communityId,
  threadId,
  parentId,
  placeholder,
  onPosted,
  onCancel,
  autoFocus,
}: {
  communityId: string;
  threadId: string;
  parentId?: string;
  placeholder?: string;
  onPosted: (comment: ThreadComment) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${threadId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parent_id: parentId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to post comment.");
      setBody("");
      onPosted(data.comment as ThreadComment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e as unknown as React.FormEvent);
        }}
        placeholder={placeholder ?? "Write a comment… (⌘↵ to post)"}
        rows={parentId ? 2 : 3}
        maxLength={5000}
        className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
      />
      {error && <p className="font-body text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="font-body text-xs text-foreground-subtle hover:text-foreground">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving || !body.trim()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-body text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          {saving ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

// ── Single comment row ───────────────────────────────────────────────────────

function CommentRow({
  comment,
  communityId,
  threadId,
  currentUserId,
  allowReplies,
  isReply,
  onDeleted,
  onReplied,
}: {
  comment: ThreadComment;
  communityId: string;
  threadId: string;
  currentUserId: string;
  allowReplies: boolean;
  isReply?: boolean;
  onDeleted: (id: string, parentId: string | null) => void;
  onReplied: (comment: ThreadComment) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = comment.user_id === currentUserId;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  async function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      await fetch(`/api/communities/${communityId}/threads/${threadId}/comments/${comment.id}`, { method: "DELETE" });
      onDeleted(comment.id, comment.parent_id);
    } finally {
      setDeleting(false);
      setMenuOpen(false);
    }
  }

  const name = comment.users?.name ?? "Member";

  return (
    <div className={`flex gap-2.5 ${isReply ? "pl-8" : ""}`}>
      <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size={isReply ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-body text-xs font-semibold text-foreground">{name}</span>
          <span className="font-body text-[11px] text-foreground-subtle">{formatRelativeDate(comment.created_at)}</span>
          {isOwner && (
            <div className="relative ml-auto" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((p) => !p)}
                className="flex h-5 w-5 items-center justify-center rounded text-foreground-subtle hover:text-foreground"
                aria-label="Comment options"
              >
                <MoreHorizontal size={13} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-6 z-20 min-w-[110px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <p className="mt-1 font-body text-sm text-foreground-muted whitespace-pre-wrap break-words">{comment.body}</p>
        {allowReplies && !isReply && (
          <button
            type="button"
            onClick={() => setReplying((p) => !p)}
            className="mt-1.5 inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle hover:text-accent"
          >
            <CornerDownRight size={11} />
            Reply
          </button>
        )}
        {replying && (
          <div className="mt-2">
            <CommentBox
              communityId={communityId}
              threadId={threadId}
              parentId={comment.id}
              placeholder="Write a reply…"
              autoFocus
              onPosted={(c) => { onReplied(c); setReplying(false); }}
              onCancel={() => setReplying(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  thread: CommunityThread;
  initialComments: ThreadComment[];
  currentUserId: string;
  communityId: string;
  communityName: string;
}

export function ThreadDetailClient({ thread: initialThread, initialComments, currentUserId, communityId, communityName }: Props) {
  const router = useRouter();
  const [thread, setThread] = useState(initialThread);
  const [comments, setComments] = useState(initialComments);
  const [votePending, setVotePending] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = thread.user_id === currentUserId;
  const category = THREAD_CATEGORIES.find((c) => c.value === thread.category);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Realtime subscriptions
  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${thread.id}/comments`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments as ThreadComment[]);
      // Update comment count on thread
      const count = (data.comments as ThreadComment[]).reduce((acc: number, c: ThreadComment) => acc + 1 + c.replies.length, 0);
      setThread((t) => ({ ...t, comment_count: count }));
    } catch { /* silent */ }
  }, [communityId, thread.id]);

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

    const commentChannel = supabase
      .channel(`thread-comments:${thread.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_comments", filter: `thread_id=eq.${thread.id}` },
        () => void fetchComments(),
      )
      .subscribe();

    const voteChannel = supabase
      .channel(`thread-votes-detail:${thread.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_votes", filter: `thread_id=eq.${thread.id}` },
        (payload) => {
          const record = (payload.new ?? payload.old) as { user_id?: string } | null;
          if (record?.user_id === currentUserId) return;
          setThread((t) => ({
            ...t,
            vote_count: payload.eventType === "INSERT"
              ? t.vote_count + 1
              : Math.max(0, t.vote_count - 1),
          }));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(commentChannel);
      supabase.removeChannel(voteChannel);
    };
  }, [thread.id, currentUserId, fetchComments]);

  async function handleDelete() {
    if (!confirm("Delete this thread? This cannot be undone.")) return;
    setDeleting(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${thread.id}`, { method: "DELETE" });
      if (res.ok) router.push(`/dashboard/communities/${communityId}`);
    } finally {
      setDeleting(false);
    }
  }

  async function handleVote() {
    if (votePending) return;
    const newVoted = !thread.user_voted;
    const newCount = thread.vote_count + (newVoted ? 1 : -1);
    setThread((t) => ({ ...t, user_voted: newVoted, vote_count: newCount }));
    setVotePending(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${thread.id}/vote`, { method: "POST" });
      if (!res.ok) setThread((t) => ({ ...t, user_voted: !newVoted, vote_count: thread.vote_count }));
    } catch {
      setThread((t) => ({ ...t, user_voted: !newVoted, vote_count: thread.vote_count }));
    } finally {
      setVotePending(false);
    }
  }

  function handleCommentPosted(comment: ThreadComment) {
    if (comment.parent_id) {
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.parent_id ? { ...c, replies: [...c.replies, comment] } : c,
        ),
      );
    } else {
      setComments((prev) => [...prev, { ...comment, replies: [] }]);
    }
    setThread((t) => ({ ...t, comment_count: t.comment_count + 1 }));
  }

  function handleCommentDeleted(id: string, parentId: string | null) {
    if (parentId) {
      setComments((prev) =>
        prev.map((c) =>
          c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== id) } : c,
        ),
      );
    } else {
      // Also subtract replies count
      const target = comments.find((c) => c.id === id);
      const removed = 1 + (target?.replies.length ?? 0);
      setComments((prev) => prev.filter((c) => c.id !== id));
      setThread((t) => ({ ...t, comment_count: Math.max(0, t.comment_count - removed) }));
      return;
    }
    setThread((t) => ({ ...t, comment_count: Math.max(0, t.comment_count - 1) }));
  }

  const authorName = thread.users?.name ?? "Member";
  const totalComments = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">

          {/* Back nav */}
          <Link
            href={`/dashboard/communities/${communityId}`}
            className="mb-5 inline-flex items-center gap-1.5 font-body text-xs text-foreground-subtle hover:text-foreground"
          >
            <ArrowLeft size={13} />
            {communityName} · Threads
          </Link>

          {/* Thread card */}
          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-stretch">
              {/* Upvote column */}
              <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 px-1 py-4">
                <button
                  type="button"
                  onClick={handleVote}
                  disabled={votePending}
                  aria-label={thread.user_voted ? "Remove upvote" : "Upvote"}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-60 ${
                    thread.user_voted ? "bg-accent/20 text-accent" : "text-foreground-subtle hover:bg-accent/10 hover:text-accent"
                  }`}
                >
                  <ChevronUp size={18} strokeWidth={thread.user_voted ? 2.5 : 2} />
                </button>
                <span className={`font-mono text-sm font-semibold tabular-nums ${thread.user_voted ? "text-accent" : "text-foreground-muted"}`}>
                  {thread.vote_count}
                </span>
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 py-4 pr-4">
                {/* Category + menu */}
                <div className="flex items-center justify-between gap-2">
                  {category && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-body text-[10px] text-foreground-muted">
                      <CategoryIcon category={category.value} size={10} />
                      {category.label}
                    </span>
                  )}
                  {isOwner && (
                    <div className="relative ml-auto" ref={menuRef}>
                      <button
                        type="button"
                        onClick={() => setMenuOpen((p) => !p)}
                        aria-label="Thread options"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-raised hover:text-foreground"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      {menuOpen && (
                        <div className="absolute right-0 top-8 z-20 min-w-[130px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => { setMenuOpen(false); setShowEdit(true); }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                          >
                            <Pencil size={11} /> Edit thread
                          </button>
                          <button
                            type="button"
                            onClick={handleDelete}
                            disabled={deleting}
                            className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                          >
                            <Trash2 size={11} />
                            {deleting ? "Deleting…" : "Delete thread"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Title */}
                <h1 className="mt-2 font-display text-lg font-semibold leading-snug text-foreground">
                  {thread.title}
                </h1>

                {/* Description */}
                <p className="mt-4 font-body text-sm leading-relaxed text-foreground-muted whitespace-pre-wrap">
                  {thread.description}
                </p>

                {/* Tags */}
                {thread.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {thread.tags.map((tag) => (
                      <span key={tag} className="font-body text-[11px] text-foreground-subtle">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Links */}
                {thread.links.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {thread.links.map((link) => (
                      <a
                        key={link}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:border-accent/40 hover:text-accent"
                      >
                        <LinkIcon size={12} />
                        <span className="min-w-0 truncate">{link}</span>
                      </a>
                    ))}
                  </div>
                )}

                {/* Attachments */}
                {thread.attachments.length > 0 && (() => {
                  const images = thread.attachments.filter((a) => a.type.startsWith("image/"));
                  const files = thread.attachments.filter((a) => !a.type.startsWith("image/"));
                  return (
                    <>
                      {images.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {images.map((img) => (
                            <a key={img.url} href={img.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-border">
                              <img src={img.url} alt={img.name} className="h-48 w-full object-cover transition-opacity hover:opacity-90" />
                            </a>
                          ))}
                        </div>
                      )}
                      {files.length > 0 && (
                        <div className="mt-4 space-y-1.5">
                          {files.map((att) => (
                            <a
                              key={att.url}
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:border-accent/40 hover:text-accent"
                            >
                              <Paperclip size={12} />
                              <span className="min-w-0 flex-1 truncate">{att.name}</span>
                              <span className="shrink-0 text-foreground-subtle">
                                {(att.size / 1024).toFixed(0)} KB
                              </span>
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Author row */}
                <div className="mt-4 flex items-center gap-2">
                  <Avatar name={authorName} avatarUrl={thread.users?.avatar_url ?? null} size="sm" />
                  <span className="font-body text-xs text-foreground-muted">{authorName}</span>
                  <span className="font-body text-[11px] text-foreground-subtle">·</span>
                  <span className="font-body text-[11px] text-foreground-subtle">{formatFullDate(thread.created_at)}</span>
                  <span className="font-body text-[11px] text-foreground-subtle">·</span>
                  <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle">
                    <MessageSquare size={11} /> {totalComments} {totalComments === 1 ? "comment" : "comments"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Comments section */}
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="font-display text-sm font-semibold text-foreground">
                {totalComments} {totalComments === 1 ? "Comment" : "Comments"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* New comment box */}
            {thread.allow_replies ? (
              <CommentBox
                communityId={communityId}
                threadId={thread.id}
                onPosted={handleCommentPosted}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-3 text-center font-body text-xs text-foreground-subtle">
                Replies are closed for this thread.
              </div>
            )}

            {/* Comment list */}
            {comments.length > 0 && (
              <div className="mt-6 space-y-5">
                {comments.map((comment) => (
                  <div key={comment.id} className="space-y-3">
                    <CommentRow
                      comment={comment}
                      communityId={communityId}
                      threadId={thread.id}
                      currentUserId={currentUserId}
                      allowReplies={thread.allow_replies}
                      onDeleted={handleCommentDeleted}
                      onReplied={handleCommentPosted}
                    />
                    {comment.replies.map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        communityId={communityId}
                        threadId={thread.id}
                        currentUserId={currentUserId}
                        allowReplies={false}
                        isReply
                        onDeleted={handleCommentDeleted}
                        onReplied={handleCommentPosted}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {comments.length === 0 && (
              <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-10 text-center">
                <MessageSquare size={22} className="mx-auto text-foreground-subtle" />
                <p className="mt-2 font-body text-sm text-foreground-muted">No comments yet. Be the first!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showEdit && (
        <EditThreadModal
          thread={thread}
          communityId={communityId}
          onClose={() => setShowEdit(false)}
          onUpdated={(updated) => setThread((t) => ({ ...t, ...updated }))}
        />
      )}
    </>
  );
}
