"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ArrowUpDown, ChevronDown, MessageSquare, MoreVertical, Plus, Smile, Trash2 } from "lucide-react";
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
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-body text-sm transition-colors ${reaction.reacted ? "border-accent/30 bg-accent/10 text-foreground" : "border-transparent bg-surface-raised text-foreground-muted hover:border-border-strong hover:text-foreground"}`}
        >
          <span aria-hidden>{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-foreground-muted shadow-sm transition-colors hover:border-border-strong hover:text-foreground"
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
        >
          <Smile size={15} />
          <Plus size={12} />
        </button>
        {pickerOpen && (
          <div className="absolute bottom-10 left-0 z-20 flex gap-1 rounded-full border border-border bg-surface p-1.5 shadow-lg">
            {COMMENT_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => void toggle(emoji)} className="flex size-8 items-center justify-center rounded-full text-base hover:bg-surface-raised" aria-label={`React with ${emoji}`}>
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
      {pending && <Spinner size={12} />}
      {error && <span className="font-body text-xs text-destructive">Reactions are unavailable.</span>}
    </div>
  );
}

function ParticipantAvatars<C extends CommunityCommentBase>({ comment }: { comment: C }) {
  const participants = [comment, ...((comment.replies ?? []) as C[])].slice(0, 4);
  return (
    <div className="flex items-center pl-1">
      {participants.map((participant, index) => (
        <div key={participant.id} className="-ml-1 rounded-full ring-2 ring-surface" style={{ zIndex: participants.length - index }}>
          <Avatar name={participant.users?.name ?? "Community member"} avatarUrl={participant.users?.avatar_url ?? null} size="md" />
        </div>
      ))}
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
    <article className={`group/comment relative ${isReply ? "rounded-2xl bg-surface-raised p-4" : ""}`}>
      {isReply && (
        <div className="mb-3">
          <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size="md" />
        </div>
      )}
      <div className="min-w-0">
        <header className="flex min-w-0 items-center gap-2 pr-8">
          <span className="truncate font-body text-sm font-semibold text-foreground">{name}</span>
          <span aria-hidden className="text-foreground-subtle">•</span>
          <time dateTime={comment.created_at} title={absoluteDate(comment.created_at)} className="shrink-0 font-body text-sm text-foreground-muted">
            {hydrated ? relativeTime(comment.created_at) : absoluteDate(comment.created_at)}
          </time>
        </header>
        {comment.user_id === currentUserId && (
          <div className="absolute right-0 top-0">
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="flex size-8 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground" aria-label="Comment options" aria-expanded={menuOpen}>
              <MoreVertical size={17} />
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
        {comment.body && <p className="mt-1.5 whitespace-pre-wrap break-words font-body text-sm leading-6 text-foreground">{renderEmojiText(comment.body)}</p>}
        {comment.image_url && (
          <a href={comment.image_url} target="_blank" rel="noopener noreferrer" className="mt-3 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={comment.image_url} alt="Comment attachment" className="max-h-48 rounded-xl border border-border object-cover" />
          </a>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ReactionBar comment={comment} endpoint={`${base}/reactions`} />
          {allowReplies && !isReply && (
            <>
              <span aria-hidden className="text-foreground-subtle">•</span>
              <button type="button" onClick={() => setReplying((open) => !open)} className="inline-flex h-8 items-center rounded-full border border-border bg-surface px-4 font-body text-sm font-medium text-foreground shadow-sm transition-colors hover:border-border-strong hover:bg-surface-raised">
                Reply
              </button>
            </>
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
    <section aria-labelledby={`comments-${targetId}`} className={compact ? "" : "rounded-2xl border border-border bg-surface p-5 sm:p-6"}>
      <h2 id={`comments-${targetId}`} className="font-display text-xl font-semibold tracking-tight text-foreground">Comments</h2>

      <div className="mt-5">
        {allowReplies ? <CommentComposer<C> communityId={communityId} kind={kind} targetId={targetId} placeholder={placeholder ?? "Add comment"} maxLength={maxLength} onPosted={onPosted} /> : <p className="rounded-xl border border-border bg-background px-4 py-3 text-center font-body text-xs text-foreground-subtle">Replies are closed for this conversation.</p>}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-foreground-muted">
          <MessageSquare size={19} />
          <span className="font-body text-sm tabular-nums">{total}</span>
        </div>
        <label className="flex items-center gap-2 font-body text-sm font-semibold text-foreground">
          <ArrowUpDown size={16} />
          <span className="sr-only">Sort comments</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as CommentSort)} className="cursor-pointer appearance-none bg-transparent pr-5 font-body text-sm font-semibold text-foreground outline-none">
            <option value="newest">Most recent</option>
            <option value="popular">Most popular</option>
          </select>
          <ChevronDown size={14} className="-ml-6 pointer-events-none" />
        </label>
      </div>

      {loading ? (
        <div className="flex min-h-32 items-center justify-center" role="status"><Spinner size={22} /><span className="sr-only">Loading comments</span></div>
      ) : sorted.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-raised text-foreground-muted"><MessageSquare size={19} /></span>
          <p className="font-body text-sm font-medium text-foreground">Start the conversation</p>
          <p className="max-w-xs font-body text-xs leading-relaxed text-foreground-muted">Share a thought, ask a question, or leave some helpful feedback.</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {sorted.map((comment) => {
            const replies = (comment.replies ?? []) as C[];
            const open = expanded[comment.id] ?? replies.length <= 2;
            return (
              <div key={comment.id} className="relative pl-10">
                <span aria-hidden className="absolute left-[13px] top-3 size-2 rounded-full bg-foreground-muted" />
                <span aria-hidden className="absolute bottom-0 left-4 top-5 border-l border-dashed border-foreground-subtle" />
                <div className="mb-3">
                  <ParticipantAvatars comment={comment} />
                </div>
                <CommentItem comment={comment} kind={kind} communityId={communityId} targetId={targetId} currentUserId={currentUserId} allowReplies={allowReplies} onPosted={onPosted} onDeleted={onDeleted} />
                {replies.length > 0 && (
                  <div className="mt-3">
                    <button type="button" onClick={() => setExpanded((value) => ({ ...value, [comment.id]: !open }))} className="inline-flex h-8 items-center font-body text-sm font-semibold text-foreground transition-colors hover:text-foreground-muted">
                      {open ? `Hide ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : `View ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
                    </button>
                    {open && (
                      <div className="mt-3 flex flex-col gap-3">
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
