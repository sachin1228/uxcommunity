"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp, MessageSquare, MoreVertical, Plus, Smile, Trash2 } from "lucide-react";
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

const subscribeToHydration = () => () => {};

function useHydrated() {
  return useSyncExternalStore(subscribeToHydration, () => true, () => false);
}

function absoluteDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value));
}

function ReactionBar({ comment, endpoint }: { comment: CommunityCommentBase; endpoint: string }) {
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
    <div className="flex flex-wrap items-center gap-2" aria-label="Comment reactions">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          aria-pressed={reaction.reacted}
          aria-label={`${reaction.emoji} reaction, ${reaction.count}`}
          onClick={() => void toggle(reaction.emoji)}
          className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-body text-[13px] transition-colors ${reaction.reacted ? "border-[var(--ds-red-700)] bg-[var(--ds-red-100)] text-[var(--ds-red-900)]" : "border-transparent bg-surface-raised text-foreground-muted hover:border-border-strong hover:text-foreground"}`}
        >
          <span aria-hidden>{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface px-2 text-foreground-muted shadow-xs transition-colors hover:border-border-strong hover:text-foreground"
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
        >
          <Smile size={13} />
          <Plus size={11} />
        </button>
        {pickerOpen && (
          <div className="absolute bottom-10 left-0 z-20 flex gap-1 rounded-full border border-border bg-surface p-1.5 shadow-lg">
            {COMMENT_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => void toggle(emoji)} className="flex size-7 items-center justify-center rounded-full text-base hover:bg-surface-raised" aria-label={`React with ${emoji}`}>
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
      {pending && <Spinner size={12} />}
      {error && <span className="font-body text-xs text-[var(--ds-red-800)]">Reactions are unavailable.</span>}
    </div>
  );
}

function CommentItem<C extends CommunityCommentBase>({
  comment,
  kind,
  communityId,
  targetId,
  currentUserId,
  isReply = false,
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
  const hydrated = useHydrated();
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
    <article className={`group/comment relative ${isReply ? "rounded-xl bg-surface-raised p-3" : ""}`}>
      <div className="min-w-0">
        <header className="flex min-w-0 items-center gap-2 pr-8">
          <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size="sm" />
          <span className="truncate font-body text-[13px] font-semibold text-foreground">{name}</span>
          <span aria-hidden className="text-foreground-subtle">•</span>
          <time dateTime={comment.created_at} title={absoluteDate(comment.created_at)} className="shrink-0 font-body text-[11px] text-foreground-muted">
            {hydrated ? relativeTime(comment.created_at) : absoluteDate(comment.created_at)}
          </time>
        </header>
        {comment.user_id === currentUserId && (
          <div className="absolute right-0 top-0">
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="flex size-7 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground" aria-label="Comment options" aria-expanded={menuOpen}>
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 min-w-[110px] rounded-lg border border-border bg-surface p-1 shadow-lg">
                <button type="button" onClick={() => { setMenuOpen(false); setConfirmDelete(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 font-body text-xs text-[var(--ds-red-800)] hover:bg-surface-raised">
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
        {comment.body && <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm leading-5 text-foreground">{renderEmojiText(comment.body)}</p>}
        {comment.image_url && (
          <a href={comment.image_url} target="_blank" rel="noopener noreferrer" className="mt-3 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={comment.image_url} alt="Comment attachment" className="max-h-36 rounded-lg border border-border object-cover" />
          </a>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ReactionBar comment={comment} endpoint={`${base}/reactions`} />
          {allowReplies && !isReply && (
            <>
              <span aria-hidden className="text-foreground-subtle">•</span>
              <button type="button" onClick={() => setReplying((open) => !open)} className="inline-flex h-7 items-center rounded-full border border-border bg-surface px-3.5 font-body text-xs font-medium text-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-surface-raised">
                Reply
              </button>
            </>
          )}
        </div>
        {replying && (
          <div className="mt-2">
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
    <section aria-labelledby={`comments-${targetId}`} className={compact ? "" : "rounded-xl border border-border bg-surface p-4 sm:p-5"}>
      <h2 id={`comments-${targetId}`} className="font-display text-base font-semibold tracking-tight text-foreground">Comments</h2>

      <div className="mt-3">
        {allowReplies ? <CommentComposer<C> communityId={communityId} kind={kind} targetId={targetId} placeholder={placeholder ?? "Add comment"} maxLength={maxLength} onPosted={onPosted} /> : <p className="rounded-xl border border-border bg-background px-4 py-3 text-center font-body text-xs text-foreground-subtle">Replies are closed for this conversation.</p>}
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-foreground-muted">
          <MessageSquare size={15} />
          <span className="font-body text-xs tabular-nums">{total}</span>
        </div>
        <label className="flex items-center gap-1.5 font-body text-xs font-semibold text-foreground">
          <ArrowUpDown size={13} />
          <select value={sort} onChange={(event) => setSort(event.target.value as CommentSort)} aria-label="Sort comments" className="cursor-pointer appearance-none bg-transparent pr-5 font-body text-xs font-semibold text-foreground outline-none">
            <option value="newest">Most recent</option>
            <option value="popular">Most popular</option>
          </select>
          <ChevronDown size={12} className="-ml-5 pointer-events-none" />
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-24 items-center justify-center" role="status"><Spinner size={18} /><span className="sr-only">Loading comments</span></div>
      ) : sorted.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
          <span className="flex size-8 items-center justify-center rounded-full bg-surface-raised text-foreground-muted"><MessageSquare size={15} /></span>
          <p className="font-body text-[13px] font-medium text-foreground">Start the conversation</p>
          <p className="max-w-xs font-body text-xs leading-relaxed text-foreground-muted">Share a thought, ask a question, or leave some helpful feedback.</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {sorted.map((comment) => {
            const replies = (comment.replies ?? []) as C[];
            const open = expanded[comment.id] ?? replies.length <= 2;
            return (
              <div key={comment.id} className="relative pl-8">
                <span aria-hidden className="absolute left-[11px] top-2.5 size-1.5 rounded-full bg-foreground-muted" />
                <span aria-hidden className="absolute bottom-0 left-3.5 top-4 border-l border-dashed border-foreground-subtle" />
                <CommentItem comment={comment} kind={kind} communityId={communityId} targetId={targetId} currentUserId={currentUserId} allowReplies={allowReplies} onPosted={onPosted} onDeleted={onDeleted} />
                {replies.length > 0 && (
                  <div className="mt-2">
                    <button type="button" onClick={() => setExpanded((value) => ({ ...value, [comment.id]: !open }))} className="inline-flex h-6 items-center gap-1 font-body text-xs font-semibold text-[var(--ds-blue-800)] transition-colors hover:text-[var(--ds-blue-900)]">
                      {open
                        ? <ChevronUp size={12} strokeWidth={2.5} className="shrink-0" />
                        : <ChevronDown size={12} strokeWidth={2.5} className="shrink-0" />}
                      {open ? `Hide ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : `View ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
                    </button>
                    {open && (
                      <div className="mt-2 flex flex-col gap-2">
                        {replies.map((reply) => <CommentItem key={reply.id} comment={reply} kind={kind} communityId={communityId} targetId={targetId} currentUserId={currentUserId} isReply allowReplies={false} onPosted={onPosted} onDeleted={onDeleted} />)}
                      </div>
                    )}
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
