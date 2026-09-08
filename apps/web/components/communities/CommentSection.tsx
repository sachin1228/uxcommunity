"use client";

import { useMemo, useState } from "react";
import { ChevronDown, CornerDownRight, MessageCircle, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { Avatar, CommentComposer, renderEmojiText } from "./CommentComposer";
import {
  COMMENT_REACTIONS,
  type CommentKind,
  type CommentReactionEmoji,
  type CommentReactionSummary,
  type CommentSort,
  type CommunityCommentBase,
} from "./comment-types";

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(value));
}

function ReactionBar({
  comment,
  endpoint,
}: {
  comment: CommunityCommentBase;
  endpoint: string;
}) {
  const [reactions, setReactions] = useState<CommentReactionSummary[]>(comment.reactions ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<CommentReactionEmoji | null>(null);
  const [error, setError] = useState(false);

  async function toggle(emoji: CommentReactionEmoji) {
    if (pending) return;
    const previous = reactions;
    const existing = previous.find((reaction) => reaction.emoji === emoji);
    const nextCount = Math.max(0, (existing?.count ?? 0) + (existing?.reacted ? -1 : 1));
    setReactions([
      ...previous.filter((reaction) => reaction.emoji !== emoji),
      ...(nextCount ? [{ emoji, count: nextCount, reacted: !existing?.reacted }] : []),
    ]);
    setPending(emoji);
    setError(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!response.ok) throw new Error();
    } catch {
      setReactions(previous);
      setError(true);
    } finally {
      setPending(null);
      setPickerOpen(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Comment reactions">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          aria-pressed={reaction.reacted}
          aria-label={`${reaction.emoji} reaction, ${reaction.count}`}
          onClick={() => void toggle(reaction.emoji)}
          className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 font-body text-xs transition-all ${reaction.reacted ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-surface text-foreground-muted hover:border-foreground-subtle hover:text-foreground"}`}
        >
          <span aria-hidden>{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
        >
          <Plus size={14} strokeWidth={2.5} />
          <span className="font-body text-xs">React</span>
        </button>
        {pickerOpen && (
          <div className="absolute bottom-10 left-0 z-20 flex gap-1 rounded-full border border-border bg-surface p-1.5 shadow-lg">
            {COMMENT_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => void toggle(emoji)} className="flex size-9 items-center justify-center rounded-full text-base transition-transform hover:scale-110 hover:bg-surface-raised" aria-label={`React with ${emoji}`}>
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
      {pending && <Spinner size={12} />}
      {error && <span className="font-body text-xs text-destructive">Apply the comment reactions migration to enable reactions.</span>}
    </div>
  );
}

function CommentItem<C extends CommunityCommentBase>({
  comment,
  kind,
  communityId,
  targetId,
  currentUserId,
  isReply,
  allowReplies,
  onPosted,
  onDeleted,
}: {
  comment: C;
  kind: CommentKind;
  communityId: string;
  targetId: string;
  currentUserId: string;
  isReply?: boolean;
  allowReplies: boolean;
  onPosted: (comment: C) => void;
  onDeleted: (id: string, parentId: string | null) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const name = comment.users?.name ?? "Community member";
  const base = `/api/communities/${communityId}/${kind}/${targetId}/comments/${comment.id}`;

  async function remove() {
    setDeleting(true);
    try {
      const response = await fetch(base, { method: "DELETE" });
      if (response.ok) onDeleted(comment.id, comment.parent_id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <article className={`group/comment relative flex gap-3 ${isReply ? "py-3" : "py-4"}`}>
      <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size={isReply ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 items-center gap-2">
          <span className="truncate font-body text-sm font-semibold text-foreground">{name}</span>
          <time dateTime={comment.created_at} title={new Date(comment.created_at).toLocaleString()} className="shrink-0 font-body text-xs text-foreground-subtle">{relativeTime(comment.created_at)}</time>
          {comment.user_id === currentUserId && (
            <div className="relative ml-auto">
              <button type="button" onClick={() => setMenuOpen((open) => !open)} className="flex size-8 items-center justify-center rounded-full text-foreground-subtle opacity-70 transition-colors hover:bg-surface-raised hover:text-foreground group-hover/comment:opacity-100" aria-label="Comment options" aria-expanded={menuOpen}>
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-9 z-20 min-w-32 rounded-xl border border-border bg-surface p-1 shadow-lg">
                  <button type="button" onClick={() => { setMenuOpen(false); setConfirmDelete(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 font-body text-xs text-destructive hover:bg-surface-raised">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </header>
        {comment.body && <p className="mt-1.5 whitespace-pre-wrap break-words font-body text-sm leading-relaxed text-foreground-muted">{renderEmojiText(comment.body)}</p>}
        {comment.image_url && (
          <a href={comment.image_url} target="_blank" rel="noopener noreferrer" className="mt-3 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={comment.image_url} alt="Comment attachment" className="max-h-56 rounded-xl border border-border object-cover" />
          </a>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReactionBar comment={comment} endpoint={`${base}/reactions`} />
          {allowReplies && !isReply && (
            <button type="button" onClick={() => setReplying((open) => !open)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 font-body text-xs font-medium text-foreground-subtle transition-colors hover:bg-surface-raised hover:text-foreground">
              <CornerDownRight size={14} /> Reply
            </button>
          )}
        </div>
        {replying && (
          <div className="mt-3">
            <CommentComposer<C> communityId={communityId} kind={kind} targetId={targetId} parentId={comment.id} placeholder={`Reply to ${name}`} autoFocus onPosted={(created) => { onPosted(created); setReplying(false); }} onCancel={() => setReplying(false)} />
          </div>
        )}
      </div>
      <ConfirmDialog open={confirmDelete} title="Delete comment?" message="This will permanently remove this comment and its replies." onClose={() => setConfirmDelete(false)} onConfirm={remove} />
      {deleting && <span className="sr-only" role="status">Deleting comment</span>}
    </article>
  );
}

export function CommentSection<C extends CommunityCommentBase>({
  comments,
  communityId,
  kind,
  targetId,
  currentUserId,
  allowReplies = true,
  loading = false,
  compact = false,
  placeholder,
  maxLength,
  onPosted,
  onDeleted,
}: {
  comments: C[];
  communityId: string;
  kind: CommentKind;
  targetId: string;
  currentUserId: string;
  allowReplies?: boolean;
  loading?: boolean;
  compact?: boolean;
  placeholder?: string;
  maxLength?: number;
  onPosted: (comment: C) => void;
  onDeleted: (id: string, parentId: string | null) => void;
}) {
  const [sort, setSort] = useState<CommentSort>("newest");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const total = comments.reduce((count, comment) => count + 1 + (comment.replies?.length ?? 0), 0);
  const sorted = useMemo(() => [...comments].sort((a, b) => sort === "popular"
    ? (b.reaction_count ?? 0) - (a.reaction_count ?? 0) || Date.parse(b.created_at) - Date.parse(a.created_at)
    : Date.parse(b.created_at) - Date.parse(a.created_at)), [comments, sort]);

  return (
    <section aria-labelledby={`comments-${targetId}`} className={compact ? "" : "rounded-2xl border border-border bg-surface/50 p-4 sm:p-6"}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 id={`comments-${targetId}`} className="font-display text-base font-semibold text-foreground">Comments</h2>
          <span className="rounded-full bg-surface-raised px-2 py-0.5 font-body text-xs font-semibold tabular-nums text-foreground-muted">{total}</span>
        </div>
        <div className="flex rounded-full border border-border bg-background p-1" aria-label="Sort comments">
          {(["newest", "popular"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setSort(value)} aria-pressed={sort === value} className={`min-h-8 rounded-full px-3 font-body text-xs font-medium capitalize transition-colors ${sort === value ? "bg-surface-raised text-foreground shadow-sm" : "text-foreground-subtle hover:text-foreground"}`}>{value}</button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        {allowReplies ? <CommentComposer<C> communityId={communityId} kind={kind} targetId={targetId} placeholder={placeholder} maxLength={maxLength} onPosted={onPosted} /> : <p className="rounded-xl border border-border bg-background px-4 py-3 text-center font-body text-xs text-foreground-subtle">Replies are closed for this conversation.</p>}
      </div>

      {loading ? (
        <div className="flex min-h-32 items-center justify-center" role="status"><Spinner size={22} /><span className="sr-only">Loading comments</span></div>
      ) : sorted.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-raised text-foreground-subtle"><MessageCircle size={19} /></span>
          <p className="font-body text-sm font-medium text-foreground">Start the conversation</p>
          <p className="max-w-xs font-body text-xs leading-relaxed text-foreground-subtle">Share a thought, ask a question, or leave some helpful feedback.</p>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-border/70">
          {sorted.map((comment) => {
            const replies = (comment.replies ?? []) as C[];
            const open = expanded[comment.id] ?? replies.length <= 2;
            return (
              <div key={comment.id}>
                <CommentItem comment={comment} kind={kind} communityId={communityId} targetId={targetId} currentUserId={currentUserId} allowReplies={allowReplies} onPosted={onPosted} onDeleted={onDeleted} />
                {replies.length > 0 && (
                  <div className="ml-4 border-l border-border pl-4 sm:ml-5 sm:pl-5">
                    {open && replies.map((reply) => <CommentItem key={reply.id} comment={reply} kind={kind} communityId={communityId} targetId={targetId} currentUserId={currentUserId} isReply allowReplies={false} onPosted={onPosted} onDeleted={onDeleted} />)}
                    <button type="button" onClick={() => setExpanded((value) => ({ ...value, [comment.id]: !open }))} className="mb-3 inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 font-body text-xs font-semibold text-accent hover:bg-accent/10">
                      <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
                      {open ? "Hide replies" : `View ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
