"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import {
  CornerDownRight, MessageSquare, MoreHorizontal, Send, Trash2,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { BackLink } from "@/components/ui/BackLink";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { CommunityThread, ThreadComment } from "./types";
import { ThreadCard } from "./ThreadCard";
import { formatRelativeDate } from "./threadShared";
import { communityFeedLayout } from "../feed-layout";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { patchCachedRequest } from "@/lib/request-cache";
import {
  fetchThreadResource,
  getThreadResource,
  invalidateThreadResources,
  patchThreadResource,
  seedThreadResource,
} from "@/lib/thread-request-cache";

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
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Spinner size={12} className="text-white" /> : <Send size={12} />}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    <>
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
                    onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
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
    <ConfirmDialog
      open={confirmDelete}
      title="Delete comment?"
      message="This will permanently remove this comment. This cannot be undone."
      onClose={() => setConfirmDelete(false)}
      onConfirm={handleDelete}
    />
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  thread: CommunityThread;
  initialComments: ThreadComment[];
  currentUserId: string;
  communityId: string;
  communityName: string;
  /** When provided, renders a back link above the post (e.g. homepage context). */
  backHref?: string;
  backLabel?: string;
  /** Removes the centered max-width and horizontal page padding for homepage details. */
  flushLayout?: boolean;
}

export function ThreadDetailClient({
  thread: initialThread,
  initialComments,
  currentUserId,
  communityId,
  backHref,
  backLabel = "Home",
  flushLayout = false,
}: Props) {
  const router = useGuardedRouter();
  const detailUrl = `/api/communities/${communityId}/threads/${initialThread.id}`;
  const commentsUrl = `${detailUrl}/comments`;
  seedThreadResource(detailUrl, { thread: initialThread }, currentUserId);
  seedThreadResource(commentsUrl, { comments: initialComments }, currentUserId);
  const cachedThread = getThreadResource<{ thread?: CommunityThread }>(detailUrl, currentUserId);
  const cachedComments = getThreadResource<{ comments?: ThreadComment[] }>(commentsUrl, currentUserId);
  const [thread, setThread] = useState(cachedThread?.thread ?? initialThread);
  const [comments, setComments] = useState(cachedComments?.comments ?? initialComments);
  const threadRef = useRef(thread);
  const commentsRef = useRef(comments);
  const isVisible = useDocumentVisible();

  const applyComments = useCallback((nextComments: ThreadComment[]) => {
    commentsRef.current = nextComments;
    setComments(nextComments);
    patchThreadResource<{ comments?: ThreadComment[] }>(
      commentsUrl,
      currentUserId,
      (cached) => ({ ...cached, comments: nextComments }),
    );
    const count = nextComments.reduce((total, comment) => total + 1 + comment.replies.length, 0);
    const nextThread = { ...threadRef.current, comment_count: count };
    threadRef.current = nextThread;
    setThread(nextThread);
    patchThreadResource<{ thread?: CommunityThread }>(
      detailUrl,
      currentUserId,
      (cached) => ({ ...cached, thread: cached.thread ? { ...cached.thread, comment_count: count } : nextThread }),
    );
  }, [commentsUrl, currentUserId, detailUrl]);

  // A remount reads SSR/cache first. Stale comments revalidate once in the background.
  useEffect(() => {
    void fetchThreadResource<{ comments?: ThreadComment[] }>(commentsUrl, {
      kind: "comments",
      userId: currentUserId,
      onRevalidated: (data) => applyComments(data.comments ?? []),
    }).then((data) => applyComments(data.comments ?? [])).catch(() => undefined);
  }, [applyComments, commentsUrl, currentUserId]);

  const fetchComments = useCallback(async () => {
    try {
      const data = await fetchThreadResource<{ comments?: ThreadComment[] }>(commentsUrl, {
        kind: "comments",
        userId: currentUserId,
        force: true,
      });
      applyComments(data.comments ?? []);
    } catch { /* silent */ }
  }, [applyComments, commentsUrl, currentUserId]);

  useEffect(() => {
    if (!isVisible) return;

    const commentsClient = new RealtimeClient({
      room: realtimeRooms.threadComments(thread.id),
      user: { id: currentUserId, name: null, avatar: null },
    });
    const unsubComments = commentsClient.on("comment", (data) => {
      const record = data as { user_id?: string } | null;
      // Local mutations already patch state and cache synchronously.
      if (record?.user_id === currentUserId) return;
      void fetchComments();
    });
    commentsClient.connect();

    const likesClient = new RealtimeClient({
      room: realtimeRooms.threads(communityId),
      user: { id: currentUserId, name: null, avatar: null },
    });
    const unsubLikes = likesClient.on("like", (data) => {
      const record = data as { event?: "INSERT" | "UPDATE" | "DELETE"; thread_id?: string; user_id?: string } | null;
      if (!record?.thread_id || record.thread_id !== thread.id) return;
      if (record.user_id === currentUserId) return;
      const current = threadRef.current;
      const next = {
        ...current,
        like_count: record.event === "INSERT"
          ? current.like_count + 1
          : Math.max(0, current.like_count - 1),
      };
      threadRef.current = next;
      setThread(next);
      patchThreadResource<{ thread?: CommunityThread }>(
        detailUrl,
        currentUserId,
        (cached) => ({ ...cached, thread: cached.thread ? { ...cached.thread, like_count: next.like_count } : next }),
      );
    });
    likesClient.connect();

    return () => {
      unsubComments();
      commentsClient.close();
      unsubLikes();
      likesClient.close();
    };
  }, [communityId, thread.id, currentUserId, detailUrl, fetchComments, isVisible]);

  // ── ThreadCard callbacks ──────────────────────────────────────────────────

  function writeThread(update: (current: CommunityThread) => CommunityThread) {
    const next = update(threadRef.current);
    threadRef.current = next;
    setThread(next);
    patchThreadResource<{ thread?: CommunityThread }>(
      detailUrl,
      currentUserId,
      (cached) => ({ ...cached, thread: cached.thread ? update(cached.thread) : next }),
    );
    patchCachedRequest<{ threads?: CommunityThread[] }>(
      `/api/communities/${communityId}/threads`,
      (cached) => ({
        ...cached,
        threads: cached.threads?.map((item) => item.id === next.id ? { ...item, ...next } : item),
      }),
      currentUserId,
    );
  }

  function handleLikeChanged(_threadId: string, liked: boolean, newCount: number) {
    writeThread((current) => ({ ...current, user_liked: liked, like_count: newCount }));
  }

  function handleSaveChanged(_threadId: string, saved: boolean) {
    writeThread((current) => ({ ...current, user_saved: saved }));
  }

  function handleUpdated(updated: CommunityThread) {
    writeThread((current) => ({ ...current, ...updated }));
  }

  function handleDeleted() {
    invalidateThreadResources(initialThread.id, currentUserId);
    patchCachedRequest<{ threads?: CommunityThread[] }>(
      `/api/communities/${communityId}/threads`,
      (cached) => ({ ...cached, threads: cached.threads?.filter((item) => item.id !== initialThread.id) }),
      currentUserId,
    );
    router.push(`/dashboard/communities/${communityId}`);
  }

  // ── Comment handlers ──────────────────────────────────────────────────────

  function writeComments(update: (current: ThreadComment[]) => ThreadComment[]) {
    const next = update(commentsRef.current);
    commentsRef.current = next;
    setComments(next);
    patchThreadResource<{ comments?: ThreadComment[] }>(
      commentsUrl,
      currentUserId,
      (cached) => ({ ...cached, comments: update(cached.comments ?? []) }),
    );
  }

  function changeCommentCount(delta: number) {
    writeThread((current) => ({
      ...current,
      comment_count: Math.max(0, current.comment_count + delta),
    }));
  }

  function handleCommentPosted(comment: ThreadComment) {
    writeComments((current) => comment.parent_id
      ? current.map((item) => item.id === comment.parent_id
        ? { ...item, replies: [...item.replies.filter((reply) => reply.id !== comment.id), comment] }
        : item)
      : [...current.filter((item) => item.id !== comment.id), { ...comment, replies: [] }]);
    changeCommentCount(1);
  }

  function handleCommentDeleted(id: string, parentId: string | null) {
    const target = parentId ? null : commentsRef.current.find((comment) => comment.id === id);
    const removed = parentId ? 1 : 1 + (target?.replies.length ?? 0);
    writeComments((current) => parentId
      ? current.map((comment) => comment.id === parentId
        ? { ...comment, replies: comment.replies.filter((reply) => reply.id !== id) }
        : comment)
      : current.filter((comment) => comment.id !== id));
    changeCommentCount(-removed);
  }

  const totalComments = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div
        className={
          flushLayout
            ? "w-full py-6"
            : `${communityFeedLayout.detailContent} ${communityFeedLayout.detailPage}`
        }
      >

        {/* ── Back link (homepage context only) ── */}
        {backHref && (
          <div className={communityFeedLayout.detailSection}>
            <BackLink
              href={backHref}
              label={backLabel}
              className="mb-4 inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted hover:text-foreground"
            />
          </div>
        )}

        {/* ── Thread card (shared component, detail variant) ── */}
        <div className={communityFeedLayout.detailSection}>
            <ThreadCard
              thread={thread}
              currentUserId={currentUserId}
              communityId={communityId}
              onLikeChanged={handleLikeChanged}
              onSaveChanged={handleSaveChanged}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
        </div>

        {/* ── Comments section ── */}
        <div className={`mx-5 mt-6 md:mx-8 ${communityFeedLayout.detailCard}`}>
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
            <div className="border-y border-border px-4 py-3 text-center font-body text-xs text-foreground-subtle">
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
            <div className={`${communityFeedLayout.emptyState} mt-6 min-h-40`}>
              <MessageSquare size={22} className={communityFeedLayout.emptyIcon} />
              <p className={communityFeedLayout.emptyDescription}>No comments yet. Be the first!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
