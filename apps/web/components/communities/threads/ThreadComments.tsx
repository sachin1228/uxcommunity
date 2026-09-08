"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  MoreVertical,
  Plus,
  Smile,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommentComposer, Avatar, renderEmojiText } from "../CommentComposer";
import { NotoEmojiSvg } from "../chat/NotoEmojiSvg";
import { ALLOWED_COMMENT_REACTIONS } from "@/lib/communities/comment-reactions";
import type { ThreadComment, CommentReactionSummary } from "./types";
import { formatRelativeDate, formatFullDate } from "./threadShared";

// ── Comment box (inline composer) ─────────────────────────────────────────────

export function CommentBox({
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
  return (
    <CommentComposer
      communityId={communityId}
      kind="threads"
      targetId={threadId}
      parentId={parentId}
      placeholder={placeholder}
      onPosted={(comment) => onPosted(comment as ThreadComment)}
      onCancel={onCancel}
      autoFocus={autoFocus}
      variant="inline"
    />
  );
}

// ── Reactions ─────────────────────────────────────────────────────────────────

function totalReactionCount(comment: ThreadComment) {
  return (comment.reactions ?? []).reduce((total, reaction) => total + reaction.count, 0);
}

// ── Single comment row ────────────────────────────────────────────────────────

function CommentRow({
  comment,
  communityId,
  threadId,
  currentUserId,
  allowReplies,
  isReply,
  isLast,
  onDeleted,
  onReplied,
  onReactionToggled,
}: {
  comment: ThreadComment;
  communityId: string;
  threadId: string;
  currentUserId: string;
  allowReplies: boolean;
  isReply?: boolean;
  /** Last item in the list — its timeline connector stops early. */
  isLast?: boolean;
  onDeleted: (id: string, parentId: string | null) => void;
  onReplied: (comment: ThreadComment) => void;
  onReactionToggled?: (commentId: string, parentId: string | null, reactions: CommentReactionSummary[]) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const reactionPending = useRef(false);
  const isOwner = comment.user_id === currentUserId;
  const name = comment.users?.name ?? "Member";
  const canReact = typeof onReactionToggled === "function";

  // Close the options menu / reaction picker on outside click or Escape.
  useEffect(() => {
    if (!menuOpen && !pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || pickerRef.current?.contains(target)) return;
      setMenuOpen(false);
      setPickerOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, pickerOpen]);

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

  /** Optimistically flip one emoji, reconcile with the server response. */
  function toggleReaction(emoji: string) {
    if (!onReactionToggled || reactionPending.current) return;
    const current = comment.reactions ?? [];
    const mine = current.find((reaction) => reaction.emoji === emoji);
    const optimistic = mine
      ? current
          .map((reaction) => (reaction.emoji === emoji ? { ...reaction, count: reaction.count - 1, reacted: false } : reaction))
          .filter((reaction) => reaction.count > 0)
      : [...current, { emoji, count: 1, reacted: true }];
    reactionPending.current = true;
    onReactionToggled(comment.id, comment.parent_id, optimistic);
    fetch(`/api/communities/${communityId}/threads/${threadId}/comments/${comment.id}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { reactions?: CommentReactionSummary[] } | null;
        if (res.ok && Array.isArray(data?.reactions)) {
          onReactionToggled(comment.id, comment.parent_id, data.reactions);
        } else {
          onReactionToggled(comment.id, comment.parent_id, current);
        }
      })
      .catch(() => onReactionToggled(comment.id, comment.parent_id, current))
      .finally(() => {
        reactionPending.current = false;
      });
  }

  return (
    <>
      <article className={`group/comment relative ${isReply ? "rounded-xl bg-surface-raised p-3" : "pl-8"}`}>
        {/* Timeline dot + dashed connector (top-level comments only) */}
        {!isReply && (
          <>
            <span aria-hidden="true" className="absolute left-[11px] top-2.5 h-1.5 w-1.5 rounded-full bg-foreground-muted" />
            <span
              aria-hidden="true"
              className={`absolute left-[14px] top-4 border-l border-dashed border-foreground-subtle ${isLast ? "bottom-2" : "-bottom-4"}`}
              style={{
                maskImage: "linear-gradient(to bottom, black 40%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, black 40%, transparent 100%)",
              }}
            />
          </>
        )}

        <div className="min-w-0">
          <header className="flex min-w-0 items-center gap-2">
            <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size="xs" />
            <span className="truncate font-body text-[13px] font-semibold text-foreground">{name}</span>
            <span aria-hidden="true" className="text-foreground-subtle">•</span>
            <time
              dateTime={comment.created_at}
              title={formatFullDate(comment.created_at)}
              className="shrink-0 font-body text-[11px] text-foreground-muted"
            >
              {formatRelativeDate(comment.created_at)}
            </time>
            {isOwner && (
              <div className="relative -mr-1 ml-auto shrink-0" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((p) => !p)}
                  className="flex size-7 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  aria-label="Comment options"
                  aria-expanded={menuOpen}
                >
                  <MoreVertical strokeWidth={2} size={14} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-8 z-20 min-w-[110px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                      disabled={deleting}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                    >
                      <Trash2 strokeWidth={2.5} size={11} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </header>

          <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm leading-5 text-foreground">
            {renderEmojiText(comment.body)}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {canReact && (
              <>
                {/* Add-reaction pill + emoji picker */}
                <div className="relative" ref={pickerRef}>
                  <button
                    type="button"
                    onClick={() => setPickerOpen((p) => !p)}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface px-2 text-foreground-muted shadow-xs transition-colors hover:text-foreground"
                    aria-label="Add reaction"
                    aria-expanded={pickerOpen}
                  >
                    <Smile strokeWidth={2} size={13} />
                    <Plus strokeWidth={2} size={11} />
                  </button>
                  {pickerOpen && (
                    <div className="absolute bottom-9 left-0 z-20 flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-lg">
                      {ALLOWED_COMMENT_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => { setPickerOpen(false); toggleReaction(emoji); }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-raised"
                          aria-label={`React with ${emoji}`}
                        >
                          <NotoEmojiSvg emoji={emoji} size={18} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Existing reactions */}
                {(comment.reactions ?? []).map((reaction) => (
                  <button
                    key={reaction.emoji}
                    type="button"
                    onClick={() => toggleReaction(reaction.emoji)}
                    aria-pressed={reaction.reacted}
                    className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 font-body text-xs font-medium tabular-nums shadow-xs transition-colors ${
                      reaction.reacted
                        ? "border-[var(--ds-blue-800)] bg-[var(--ds-blue-800)]/10 text-[var(--ds-blue-800)]"
                        : "border-border bg-surface text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <NotoEmojiSvg emoji={reaction.emoji} size={14} />
                    {reaction.count}
                  </button>
                ))}

                <span aria-hidden="true" className="text-foreground-subtle">•</span>
              </>
            )}

            {allowReplies && !isReply && (
              <button
                type="button"
                onClick={() => setReplying((p) => !p)}
                className="inline-flex h-7 items-center rounded-full border border-border bg-surface px-3.5 font-body text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-surface-raised"
              >
                Reply
              </button>
            )}
          </div>

          {replying && (
            <div className="mt-2">
              <CommentBox
                communityId={communityId}
                threadId={threadId}
                parentId={comment.id}
                placeholder="Write a reply…"
                autoFocus
                onPosted={(c) => { onReplied(c); setReplying(false); setRepliesOpen(true); }}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}

          {!isReply && comment.replies.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setRepliesOpen((p) => !p)}
                className="inline-flex h-6 items-center gap-1 font-body text-xs font-semibold text-[var(--ds-blue-800)] transition-colors hover:text-[var(--ds-blue-900)]"
                aria-expanded={repliesOpen}
              >
                {repliesOpen
                  ? <ChevronUp strokeWidth={2.5} size={12} className="shrink-0" />
                  : <ChevronDown strokeWidth={2.5} size={12} className="shrink-0" />}
                {repliesOpen ? "Hide" : "View"} {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
              </button>
              {repliesOpen && (
                <div className="mt-2 flex flex-col gap-2">
                  {comment.replies.map((reply) => (
                    <CommentRow
                      key={reply.id}
                      comment={reply}
                      communityId={communityId}
                      threadId={threadId}
                      currentUserId={currentUserId}
                      allowReplies={false}
                      isReply
                      onDeleted={onDeleted}
                      onReplied={onReplied}
                      onReactionToggled={onReactionToggled}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </article>

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

// ── Section: composer · count/sort toolbar · timeline list ────────────────────

export function CommentsSection({
  communityId,
  threadId,
  allowReplies,
  comments,
  currentUserId,
  emptyState,
  onPosted,
  onDeleted,
  onReactionToggled,
}: {
  communityId: string;
  threadId: string;
  allowReplies: boolean;
  comments: ThreadComment[];
  currentUserId: string;
  /** Shown in place of the list when there are no comments. */
  emptyState?: React.ReactNode;
  onPosted: (comment: ThreadComment) => void;
  onDeleted: (id: string, parentId: string | null) => void;
  onReactionToggled?: (commentId: string, parentId: string | null, reactions: CommentReactionSummary[]) => void;
}) {
  const [sort, setSort] = useState<"newest" | "popular">("newest");

  const sorted = useMemo(() => {
    const list = [...comments];
    list.sort((a, b) => sort === "popular"
      ? totalReactionCount(b) - totalReactionCount(a) || Date.parse(b.created_at) - Date.parse(a.created_at)
      : Date.parse(b.created_at) - Date.parse(a.created_at));
    return list;
  }, [comments, sort]);

  const total = comments.reduce((acc, comment) => acc + 1 + comment.replies.length, 0);

  return (
    <div>
      {allowReplies ? (
        <CommentBox communityId={communityId} threadId={threadId} onPosted={onPosted} />
      ) : (
        <div className="rounded-xl border border-border px-4 py-3 text-center font-body text-xs text-foreground-subtle">
          Replies are closed for this thread.
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-foreground-muted">
          <MessageSquare strokeWidth={2} size={15} />
          <span className="font-body text-xs tabular-nums">{total}</span>
        </div>
        <label className="flex items-center gap-1.5 font-body text-xs font-semibold text-foreground">
          <ArrowUpDown strokeWidth={2} size={13} />
          <select
            aria-label="Sort comments"
            value={sort}
            onChange={(e) => setSort(e.target.value as "newest" | "popular")}
            className="cursor-pointer appearance-none bg-transparent pr-4 font-body text-xs font-semibold text-foreground outline-none"
          >
            <option value="newest">Most recent</option>
            <option value="popular">Most popular</option>
          </select>
          <ChevronDown strokeWidth={2} size={12} className="-ml-4 pointer-events-none" />
        </label>
      </div>

      {sorted.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          {sorted.map((comment, index) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              communityId={communityId}
              threadId={threadId}
              currentUserId={currentUserId}
              allowReplies={allowReplies}
              isLast={index === sorted.length - 1}
              onDeleted={onDeleted}
              onReplied={onPosted}
              onReactionToggled={onReactionToggled}
            />
          ))}
        </div>
      ) : (
        emptyState ?? null
      )}
    </div>
  );
}
