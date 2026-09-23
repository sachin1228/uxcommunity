"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Flag,
  MessageSquare,
  MoreHorizontal,
  Smile,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommentComposer, Avatar, renderEmojiText } from "./CommentComposer";
import { NotoEmojiSvg } from "./chat/NotoEmojiSvg";
import { ALLOWED_COMMENT_REACTIONS } from "@/lib/communities/comment-reactions";
import type { CommentReactionSummary } from "@/lib/communities/comment-reactions";
import { formatRelativeDate, formatFullDate } from "./threads/threadShared";

/**
 * Shared comment section used by every community content type (threads,
 * showcase, resources, events). It renders the "threads card" design — a
 * timeline spine, emoji reactions, a sort toolbar, and collapsible reply
 * threads — and is generic over the comment shape so each content type can
 * pass its own comment records.
 */

/** URL segment for the comments API, e.g. "threads" → …/threads/:targetId/comments */
export type CommentKind = "threads" | "resources" | "showcase" | "events";

/** Minimal comment shape every content type's comment satisfies. */
export interface CommunityComment {
  id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  users: { name: string; avatar_url: string | null; designation?: string | null } | null;
  replies?: CommunityComment[];
  reactions?: CommentReactionSummary[];
  image_url?: string | null;
}

// ── Comment box (inline composer) ─────────────────────────────────────────────

export function CommentBox<C>({
  communityId,
  kind,
  targetId,
  parentId,
  placeholder,
  initialBody,
  submitLabel,
  maxLength,
  onPosted,
  onCancel,
  autoFocus,
}: {
  communityId: string;
  kind: CommentKind;
  targetId: string;
  parentId?: string;
  placeholder?: string;
  /** Seeded text (e.g. an `@Name ` mention when replying to a specific comment). */
  initialBody?: string;
  /** Label for the submit pill ("Send" by default, "Reply" in reply threads). */
  submitLabel?: string;
  maxLength?: number;
  onPosted: (comment: C) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <CommentComposer<C>
      communityId={communityId}
      kind={kind}
      targetId={targetId}
      parentId={parentId}
      placeholder={placeholder}
      initialBody={initialBody}
      submitLabel={submitLabel}
      maxLength={maxLength}
      onPosted={onPosted}
      onCancel={onCancel}
      autoFocus={autoFocus}
      variant="inline"
    />
  );
}

// ── Reactions ─────────────────────────────────────────────────────────────────

function totalReactionCount(comment: CommunityComment) {
  return (comment.reactions ?? []).reduce((total, reaction) => total + reaction.count, 0);
}

/**
 * Translucent blue wash for the "selected" states in a comment's action row
 * (you reacted with this emoji / the reply composer is aimed here).
 *
 * Applied inline on purpose: Tailwind does not emit `color-mix()` for an
 * arbitrary CSS-var utility with an opacity modifier — `bg-[var(--ds-blue-800)]/10`
 * silently compiles to nothing (same workaround as MessageBubble's row flash).
 */
const SELECTED_ACTION_STYLE: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--ds-blue-800) 12%, transparent)",
};

/**
 * Seed text for the reply composer: mentioning the author we're replying to,
 * like LinkedIn — unless it's our own comment.
 */
function replyMention(target: CommunityComment, currentUserId: string): string | undefined {
  const name = target.users?.name;
  if (!name || target.user_id === currentUserId) return undefined;
  return `@${name} `;
}

/**
 * Every author name present in the section — the candidates `@mention`
 * highlighting matches against, so a seeded multi-word name ("@Vishal Gn") is
 * painted whole. Comments store no mention records, so this is the only roster
 * available without another request; anything else falls back to the bare
 * `@token`.
 */
function participantNames(comments: readonly CommunityComment[]): string[] {
  const names = new Set<string>();
  for (const comment of comments) {
    const name = comment.users?.name?.trim();
    if (name) names.add(name);
    for (const reply of comment.replies ?? []) {
      const replyName = reply.users?.name?.trim();
      if (replyName) names.add(replyName);
    }
  }
  return [...names];
}

// ── Single comment row ────────────────────────────────────────────────────────

function CommentRow<C extends CommunityComment>({
  comment,
  communityId,
  kind,
  targetId,
  currentUserId,
  allowReplies,
  isReply,
  mentionNames,
  replyTarget,
  onReplyTargetChange,
  onDeleted,
  onReplied,
  onReactionToggled,
}: {
  comment: C;
  communityId: string;
  kind: CommentKind;
  targetId: string;
  currentUserId: string;
  allowReplies: boolean;
  isReply?: boolean;
  /** Display names to highlight as `@mentions` in the body (longest wins). */
  mentionNames: readonly string[];
  /** The comment the open reply composer is aimed at (lifted so only one composer exists per thread). */
  replyTarget?: C | null;
  onReplyTargetChange?: (target: C | null) => void;
  onDeleted: (id: string, parentId: string | null) => void;
  onReplied: (comment: C) => void;
  onReactionToggled?: (commentId: string, parentId: string | null, reactions: CommentReactionSummary[]) => void;
}) {
  // Replies are expanded by default (LinkedIn-style); "Hide replies" folds them.
  const [repliesOpen, setRepliesOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Report is a signal to moderators, not a stored record — the option just
  // acknowledges the tap ("Reported") for a moment, like the thread, resource
  // and event menus do.
  const [reported, setReported] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const reactionPending = useRef(false);
  const isOwner = comment.user_id === currentUserId;
  const name = comment.users?.name ?? "Member";
  const designation = comment.users?.designation ?? null;
  const canReact = typeof onReactionToggled === "function";
  const hasReplies = !isReply && (comment.replies ?? []).length > 0;
  // True on the top-level comment whose thread hosts the open reply composer
  // (the target is either this comment itself or one of its replies).
  const replyTargetId = replyTarget?.id ?? null;
  const hostsReplyComposer = Boolean(
    !isReply && replyTarget && (replyTarget.id === comment.id || replyTarget.parent_id === comment.id),
  );
  const activeReplyTarget = hostsReplyComposer ? replyTarget! : null;
  // Top-level comments with a reply thread hang a connector track in the
  // avatar gutter, spanning the replies (and the inline composer) below them.
  const showConnector = !isReply && (hasReplies || hostsReplyComposer);

  /** Open the inline composer (anchored at the bottom of the thread) aimed at this comment. */
  function startReply() {
    onReplyTargetChange?.(replyTarget?.id === comment.id ? null : comment);
    setRepliesOpen(true);
  }

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
      await fetch(`/api/communities/${communityId}/${kind}/${targetId}/comments/${comment.id}`, { method: "DELETE" });
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
    fetch(`/api/communities/${communityId}/${kind}/${targetId}/comments/${comment.id}/reactions`, {
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
      <article className="group/comment relative flex gap-3">
        {/* Avatar gutter. The avatar is a circle pinned to the left edge, and
            the thread's connector drops from beneath it, curving right under
            the last reply — the nested-comment bracket shown in the design,
            replacing the old dashed timeline spine. */}
        <div className="flex shrink-0 flex-col items-center">
          {/* One avatar size for the whole thread, replies included — a reply is
              the same person as a top-level comment, so it is not scaled down. */}
          <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size="lg" />
          {showConnector && (
            <span aria-hidden="true" className="relative mt-1 w-4 flex-1">
              {/* Border colour is expressed as alpha stops rather than the
                  `border-strong` token: that token only exists inside the dark
                  `:root`, and `border-border-strong` is not emitted by Tailwind
                  at all — the declaration silently fell back to preflight's
                  `#e5e7eb`, which is why the line read as white. */}
              <span className="absolute bottom-1 left-2 top-0 w-4 rounded-bl-2xl border-b border-l border-black/10 dark:border-white/15" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* The row must be exactly one line tall so the name lines up with the
              top of the avatar. `leading-5` is inherited as a fixed 20px, so the
              16px separator dot and the 11px timestamp share one 20px band
              instead of each opening a taller line of their own, and the 28px
              options button is kept out of the height by a negative block
              margin while keeping its full hit area. */}
          <header className="flex min-w-0 items-center gap-2 leading-5">
            {/* Same name treatment as the members list (text-sm / semibold),
                so an author reads the same in a comment as in the roster. */}
            <span className="truncate font-body text-sm font-semibold text-foreground">{name}</span>
            <span aria-hidden="true" className="text-foreground-subtle">•</span>
            <time
              dateTime={comment.created_at}
              title={formatFullDate(comment.created_at)}
              className="shrink-0 font-body text-[11px] text-foreground-muted"
            >
              {formatRelativeDate(comment.created_at)}
            </time>
            {/* Every comment carries the menu: Report is open to everyone,
                Delete only to the author. */}
            <div className="relative -mr-1 -my-1.5 ml-auto shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((p) => !p)}
                className="flex size-7 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                aria-label="Comment options"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal strokeWidth={2.5} size={16} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-20 min-w-[110px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                      disabled={deleting}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                    >
                      <Trash2 strokeWidth={2.5} size={11} />
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setReported(true);
                      setTimeout(() => setReported(false), 3000);
                    }}
                    disabled={reported}
                    className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
                  >
                    <Flag strokeWidth={2.5} size={11} />
                    {reported ? "Reported" : "Report"}
                  </button>
                </div>
              )}
            </div>
          </header>

          {/* The author's experience level, tracking the name on its own line.
              Plain secondary text rather than a chip — it is a label about the
              person, not a control. Absent when the profile has no level. */}
          {designation && (
            <p className="font-body text-xs text-foreground-muted">{designation}</p>
          )}

          <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm leading-5 text-foreground">
            {renderEmojiText(comment.body, mentionNames)}
          </p>

          {comment.image_url && (
            <a href={comment.image_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
              <img
                src={comment.image_url}
                alt="Attachment"
                className="max-h-56 rounded-xl border border-border object-cover"
              />
            </a>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
            {canReact && (
              <>
                {/* Add-reaction + emoji picker — a flat icon button, matching
                    the borderless action row in the design. */}
                <div className="relative" ref={pickerRef}>
                  <button
                    type="button"
                    onClick={() => setPickerOpen((p) => !p)}
                    // The negative margin cancels this button's own padding so
                    // the emoji glyph — not its hit area — lines up with the
                    // comment text above, in the same column.
                    className="-ml-1.5 inline-flex h-7 items-center rounded-md px-1.5 text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                    aria-label="Add reaction"
                    aria-expanded={pickerOpen}
                  >
                    <Smile strokeWidth={2} size={16} />
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

                {/* Existing reactions — flat chips, tinted when you're one of
                    the people who reacted. */}
                {(comment.reactions ?? []).map((reaction) => (
                  <button
                    key={reaction.emoji}
                    type="button"
                    onClick={() => toggleReaction(reaction.emoji)}
                    aria-pressed={reaction.reacted}
                    className={`inline-flex h-7 items-center gap-1 rounded-md px-2 font-body text-xs font-medium tabular-nums transition-colors ${
                      reaction.reacted
                        ? "text-[var(--ds-blue-800)] dark:text-[var(--ds-blue-900)]"
                        : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                    }`}
                    style={reaction.reacted ? SELECTED_ACTION_STYLE : undefined}
                  >
                    <NotoEmojiSvg emoji={reaction.emoji} size={14} />
                    {reaction.count}
                  </button>
                ))}
              </>
            )}

            {allowReplies && (
              <button
                type="button"
                onClick={startReply}
                aria-pressed={replyTarget?.id === comment.id}
                className={`ml-1 inline-flex h-7 items-center rounded-md px-2 font-body text-xs font-semibold transition-colors ${
                  replyTarget?.id === comment.id
                    ? "text-[var(--ds-blue-800)] dark:text-[var(--ds-blue-900)]"
                    // Muted like the emoji icon it sits beside — the action row
                    // reads as one quiet strip, not one loud button.
                    : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                }`}
                style={replyTarget?.id === comment.id ? SELECTED_ACTION_STYLE : undefined}
              >
                Reply
              </button>
            )}
          </div>

          {/* ── Reply thread (top-level comments only): flat replies under the
                connector → hide/view toggle → inline composer anchored at the
                bottom, like LinkedIn ── */}
          {!isReply && (hasReplies || hostsReplyComposer) && (
            <div className="mt-3">
              {hasReplies && repliesOpen && (
                <div className="flex flex-col gap-3">
                  {(comment.replies ?? []).map((reply) => (
                    <CommentRow
                      key={reply.id}
                      comment={reply as C}
                      communityId={communityId}
                      kind={kind}
                      targetId={targetId}
                      currentUserId={currentUserId}
                      allowReplies={allowReplies}
                      isReply
                      mentionNames={mentionNames}
                      replyTarget={replyTarget}
                      onReplyTargetChange={onReplyTargetChange}
                      onDeleted={onDeleted}
                      onReplied={onReplied}
                      onReactionToggled={onReactionToggled}
                    />
                  ))}
                </div>
              )}

              {hasReplies && (
                <button
                  type="button"
                  onClick={() => setRepliesOpen((p) => !p)}
                  className="mt-3 inline-flex items-center gap-1 font-body text-xs font-semibold text-foreground transition-colors hover:text-foreground-muted"
                  aria-expanded={repliesOpen}
                >
                  {repliesOpen
                    ? "Hide replies"
                    : `View ${(comment.replies ?? []).length} ${(comment.replies ?? []).length === 1 ? "reply" : "replies"}`}
                  <ChevronUp
                    strokeWidth={2.5}
                    size={14}
                    className={`transition-transform duration-150 ${repliesOpen ? "" : "rotate-180"}`}
                  />
                </button>
              )}

              {activeReplyTarget && (
                <div className="mt-3">
                  <CommentBox
                    key={activeReplyTarget.id}
                    communityId={communityId}
                    kind={kind}
                    targetId={targetId}
                    // One level of nesting: always reply into the top-level comment.
                    parentId={comment.id}
                    initialBody={replyMention(activeReplyTarget, currentUserId)}
                    submitLabel="Reply"
                    placeholder="Write a reply…"
                    autoFocus
                    onPosted={onReplied}
                    onCancel={() => onReplyTargetChange?.(null)}
                  />
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

export function CommentSection<C extends CommunityComment>({
  communityId,
  kind,
  targetId,
  allowReplies,
  comments,
  currentUserId,
  emptyState,
  composerPlaceholder,
  composerMaxLength,
  onPosted,
  onDeleted,
  onReactionToggled,
}: {
  communityId: string;
  kind: CommentKind;
  targetId: string;
  allowReplies: boolean;
  comments: C[];
  currentUserId: string;
  /** Shown in place of the list when there are no comments. */
  emptyState?: React.ReactNode;
  /** Placeholder for the top-level composer (default "Add comment"). */
  composerPlaceholder?: string;
  /** Max length for the top-level composer (default 5000). */
  composerMaxLength?: number;
  onPosted: (comment: C) => void;
  onDeleted: (id: string, parentId: string | null) => void;
  onReactionToggled?: (commentId: string, parentId: string | null, reactions: CommentReactionSummary[]) => void;
}) {
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  // Which comment the single inline reply composer is aimed at (null = closed).
  const [replyTarget, setReplyTarget] = useState<C | null>(null);

  const sorted = useMemo(() => {
    const list = [...comments];
    list.sort((a, b) => sort === "popular"
      ? totalReactionCount(b) - totalReactionCount(a) || Date.parse(b.created_at) - Date.parse(a.created_at)
      : Date.parse(b.created_at) - Date.parse(a.created_at));
    return list;
  }, [comments, sort]);

  const total = comments.reduce((acc, comment) => acc + 1 + (comment.replies ?? []).length, 0);

  // Author names in this thread, so reply mentions of them are highlighted as
  // one tag — including multi-word names.
  const mentionNames = useMemo(() => participantNames(comments), [comments]);

  return (
    <div>
      {allowReplies ? (
        <CommentBox
          communityId={communityId}
          kind={kind}
          targetId={targetId}
          placeholder={composerPlaceholder}
          maxLength={composerMaxLength}
          onPosted={onPosted}
        />
      ) : (
        <div className="rounded-xl border border-border px-4 py-3 text-center font-body text-xs text-foreground-subtle">
          Replies are closed.
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
          {sorted.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              communityId={communityId}
              kind={kind}
              targetId={targetId}
              currentUserId={currentUserId}
              allowReplies={allowReplies}
              mentionNames={mentionNames}
              replyTarget={replyTarget}
              onReplyTargetChange={setReplyTarget}
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
