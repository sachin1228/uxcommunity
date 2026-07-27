"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CornerDownRight, Loader2, MessageSquare, MoreHorizontal, Send, Trash2,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CommunityThread, ThreadComment } from "./types";
import { ThreadCard } from "./ThreadCard";
import { formatRelativeDate } from "./threadShared";

// ── Avatar ────────────────────────────────────────────────────────────────────

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

// ── Comment Box ───────────────────────────────────────────────────────────────

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

// ── Single comment row ────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  thread: CommunityThread;
  initialComments: ThreadComment[];
  currentUserId: string;
  communityId: string;
  communityName: string;
}

export function ThreadDetailClient({
  thread: initialThread,
  initialComments,
  currentUserId,
  communityId,
}: Props) {
  const router = useRouter();
  const [thread, setThread] = useState(initialThread);
  const [comments, setComments] = useState(initialComments);

  // ── Realtime: refetch comments on any change ──────────────────────────────
  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${thread.id}/comments`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments as ThreadComment[]);
      const count = (data.comments as ThreadComment[]).reduce(
        (acc: number, c: ThreadComment) => acc + 1 + c.replies.length,
        0,
      );
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

  // ── ThreadCard callbacks ──────────────────────────────────────────────────

  function handleVoteChanged(_threadId: string, voted: boolean, newCount: number) {
    setThread((t) => ({ ...t, user_voted: voted, vote_count: newCount }));
  }

  function handleSaveChanged(_threadId: string, saved: boolean) {
    setThread((t) => ({ ...t, user_saved: saved }));
  }

  function handleUpdated(updated: CommunityThread) {
    setThread((t) => ({ ...t, ...updated }));
  }

  function handleDeleted() {
    router.push(`/dashboard/communities/${communityId}`);
  }

  // ── Comment handlers ──────────────────────────────────────────────────────

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
      const target = comments.find((c) => c.id === id);
      const removed = 1 + (target?.replies.length ?? 0);
      setComments((prev) => prev.filter((c) => c.id !== id));
      setThread((t) => ({ ...t, comment_count: Math.max(0, t.comment_count - removed) }));
      return;
    }
    setThread((t) => ({ ...t, comment_count: Math.max(0, t.comment_count - 1) }));
  }

  const totalComments = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">

        {/* ── Thread card (shared component, detail variant) ── */}
        <ThreadCard
          thread={thread}
          currentUserId={currentUserId}
          communityId={communityId}
          variant="detail"
          onVoteChanged={handleVoteChanged}
          onSaveChanged={handleSaveChanged}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />

        {/* ── Comments section ── */}
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
  );
}
