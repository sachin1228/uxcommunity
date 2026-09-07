"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  Bookmark, Flag,
  MoreHorizontal, Paperclip, Pencil, Trash2,
} from "lucide-react";
import { HeartIcon } from "../HeartIcon";
import { CommentIcon } from "../CommentIcon";

import type { CommunityThread } from "./types";
import { THREAD_CATEGORIES } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

import { renderWithLinks } from "./renderWithLinks";
import { EditThreadModal } from "./EditThreadModal";
import { ThreadPollResult } from "./PollResult";
import { ThreadImageCarousel } from "./ThreadImageCarousel";
import { ThreadImageLightbox } from "./ThreadImageLightbox";
import { formatRelativeDate, isThreadEdited } from "./threadShared";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { PostAuthorMeta } from "../PostAuthorMeta";

interface ThreadCardProps {
  thread: CommunityThread;
  currentUserId: string;
  communityId: string;
  onUpdated: (thread: CommunityThread) => void;
  onLikeChanged: (threadId: string, liked: boolean, newCount: number) => void;
  onSaveChanged: (threadId: string, saved: boolean) => void;
  onPollVoteChanged?: (threadId: string, counts: number[], userVote: number | null, undoUsed: boolean) => void;
  onDeleted: (threadId: string) => void;
  communityName?: string;
  communityImage?: string | null;
  communityNamePlacement?: "header" | "below";
  /** When provided, the card is clickable and navigates via this callback. */
  onOpen?: () => void;
}

export function ThreadCard({
  thread,
  currentUserId,
  communityId,
  onUpdated,
  onLikeChanged,
  onSaveChanged,
  onPollVoteChanged,
  onDeleted,
  communityName,
  communityImage,
  communityNamePlacement = "header",
  onOpen,
}: ThreadCardProps) {
  const isDetail = !onOpen;
  const category = THREAD_CATEGORIES.find((item) => item.value === thread.category);
  const isOwner = thread.user_id === currentUserId;

  const latestLikeRef = useRef({ thread, onLikeChanged });
  const initialLikedRef = useRef(thread.user_liked);
  const desiredLikeRef = useRef(thread.user_liked);
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const displayedSaved = optimisticSaved ?? thread.user_saved;
  const likeCoalescerRef = useRef<BooleanIntentCoalescer | null>(null);
  const saveCoalescerRef = useRef<BooleanIntentCoalescer | null>(null);

  useEffect(() => {
    latestLikeRef.current = { thread, onLikeChanged };
  });
  const [menuOpen, setMenuOpen]       = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [reported, setReported]       = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [pollVoteBusy, setPollVoteBusy] = useState(false);
  const [pollVoteOverride, setPollVoteOverride] = useState<{ counts: number[]; userVote: number | null; undoUsed: boolean } | null>(null);
  // Synchronous guard against overlapping vote/undo requests — state flushes
  // async, so a second click in the same tick can't be stopped by pollVoteBusy.
  const pollVoteBusyRef = useRef(false);
  const interactionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [titleOverflow, setTitleOverflow] = useState(false);
  const [morePos, setMorePos] = useState<{ left: number; bottom: number } | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  // Collapse long thread bodies to two lines on feed cards and offer a "…More" toggle.
  // The toggle sits right after the LAST VISIBLE LINE of text (same line, same row) so it
  // hugs the final word — even when the last clamped line is blank (e.g. a paragraph break
  // lands on line 2). Re-measured on resize and once web fonts load.
  useIsomorphicLayoutEffect(() => {
    if (isDetail) return;
    setTitleExpanded(false);
    const el = titleRef.current;
    if (!el) return;

    const measure = () => {
      try {
        setTitleOverflow(el.scrollHeight - el.clientHeight > 1);
        const box = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects()).filter(
          (r) => r.width > 0 && r.bottom <= box.bottom + 1,
        );
        const lastLine = rects[rects.length - 1];
        if (!lastLine) return;
        // Clamp so the toggle always fits inside the card (covers the tail on full lines).
        const left = Math.min(lastLine.right - box.left, box.width - 64);
        setMorePos({
          left: Math.max(0, left),
          bottom: Math.max(0, box.bottom - lastLine.bottom),
        });
      } catch {
        setMorePos(null);
      }
    };

    measure();
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [isDetail, thread.title]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  function showInteractionError(message: string) {
    setInteractionError(message);
    if (interactionErrorTimerRef.current) clearTimeout(interactionErrorTimerRef.current);
    interactionErrorTimerRef.current = setTimeout(() => setInteractionError(null), 4000);
  }

  async function handleDelete() {
    setDeleting(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${thread.id}`, { method: "DELETE" });
      if (res.ok) onDeleted(thread.id);
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    const threadId = thread.id;
    const coordinator = new BooleanIntentCoalescer({
      initialValue: initialLikedRef.current,
      onOptimisticChange: (liked) => {
        desiredLikeRef.current = liked;
        const current = latestLikeRef.current;
        const count = Math.max(
          0,
          current.thread.like_count + (liked === current.thread.user_liked ? 0 : liked ? 1 : -1),
        );
        current.onLikeChanged(current.thread.id, liked, count);
      },
      persist: async (liked) => {
        const response = await dedupeFetch(
          `/api/communities/${communityId}/threads/${threadId}/like`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ liked }),
          },
          { cooldownMode: "exact" },
        );
        const result = (await response.json().catch(() => null)) as {
          liked?: boolean;
          count?: number;
          error?: string;
        } | null;
        if (!response.ok || typeof result?.liked !== "boolean") {
          throw new Error(result?.error ?? "Failed to update like.");
        }
        const current = latestLikeRef.current;
        if (desiredLikeRef.current === result.liked) {
          current.onLikeChanged(threadId, result.liked, result.count ?? current.thread.like_count);
        }
        return result.liked;
      },
      onError: (error) => {
        showInteractionError(error instanceof Error ? error.message : "Failed to update like.");
      },
    });

    likeCoalescerRef.current = coordinator;
    return () => {
      coordinator.dispose();
      likeCoalescerRef.current = null;
    };
  }, [communityId, thread.id]);

  function getSaveCoalescer() {
    if (!saveCoalescerRef.current) {
      saveCoalescerRef.current = new BooleanIntentCoalescer({
        initialValue: thread.user_saved,
        onOptimisticChange: (saved) => {
          setOptimisticSaved(saved);
          onSaveChanged(thread.id, saved);
        },
        persist: async (saved) => {
          const response = await dedupeFetch(
            `/api/communities/${communityId}/threads/${thread.id}/save`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ saved }),
            },
            { cooldownMode: "url" },
          );
          const result = (await response.json().catch(() => null)) as {
            saved?: boolean;
            error?: string;
          } | null;
          if (!response.ok || typeof result?.saved !== "boolean") {
            throw new Error(result?.error ?? "Failed to update save.");
          }
          return result.saved;
        },
        onError: (error) => {
          showInteractionError(error instanceof Error ? error.message : "Failed to update save.");
        },
      });
    }
    return saveCoalescerRef.current;
  }

  useEffect(() => () => {
    saveCoalescerRef.current?.dispose();
    if (interactionErrorTimerRef.current) clearTimeout(interactionErrorTimerRef.current);
  }, []);

  useEffect(() => {
    likeCoalescerRef.current?.syncConfirmed(thread.user_liked);
  }, [thread.user_liked]);

  useEffect(() => {
    saveCoalescerRef.current?.syncConfirmed(thread.user_saved);
  }, [thread.user_saved]);

  // Reflect externally-confirmed totals (parent sync or realtime) once they land.
  useEffect(() => {
    setPollVoteOverride(null);
  }, [thread.poll_vote_counts, thread.poll_user_vote, thread.poll_undo_used]);

  function handleSave(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    getSaveCoalescer().toggle();
  }

  function handleLike(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    likeCoalescerRef.current?.toggle();
  }

  async function handlePollVote(optionIndex: number) {
    const currentPoll = thread.poll;
    if (!currentPoll || pollVoteBusyRef.current) return;
    const optionCount = currentPoll.options.length;
    if (optionIndex < 0 || optionIndex >= optionCount) return;

    // Votes are final: a user who already voted cannot vote again or change it.
    const currentUserVote = pollVoteOverride ? pollVoteOverride.userVote : (thread.poll_user_vote ?? null);
    if (currentUserVote !== null) return;

    // Optimistic vote: flip to the results immediately (clicked option +1) and
    // let the server round trip confirm or roll it back — no waiting spinner.
    // The optimistic state stays local to this card; parents and realtime only
    // ever receive server-confirmed totals so a failed vote can't poison the
    // shared cache.
    pollVoteBusyRef.current = true;
    const optimisticCounts = displayedPollCounts.map((count, index) =>
      index === optionIndex ? count + 1 : count,
    );
    setPollVoteOverride({ counts: optimisticCounts, userVote: optionIndex, undoUsed: displayedPollUndoUsed });

    try {
      const response = await dedupeFetch(
        `/api/communities/${communityId}/threads/${thread.id}/poll`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ option_index: optionIndex }),
        },
        { cooldownMode: "exact" },
      );
      const result = (await response.json().catch(() => null)) as {
        counts?: number[];
        user_vote?: number | null;
        undo_used?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !Array.isArray(result?.counts)) {
        throw new Error(result?.error ?? "Failed to record your vote.");
      }
      // Server-confirmed totals replace the optimistic ones.
      setPollVoteOverride({ counts: result.counts, userVote: result.user_vote ?? null, undoUsed: result.undo_used === true });
      onPollVoteChanged?.(thread.id, result.counts, result.user_vote ?? null, result.undo_used === true);
    } catch (error) {
      // Roll back to the pre-vote state; the user can try again.
      setPollVoteOverride(null);
      showInteractionError(error instanceof Error ? error.message : "Failed to record your vote.");
    } finally {
      pollVoteBusyRef.current = false;
    }
  }

  async function handlePollUndo() {
    if (!thread.poll || pollVoteBusyRef.current) return;
    pollVoteBusyRef.current = true;
    setPollVoteBusy(true);
    try {
      const response = await dedupeFetch(
        `/api/communities/${communityId}/threads/${thread.id}/poll`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "undo" }),
        },
        { cooldownMode: "exact" },
      );
      const result = (await response.json().catch(() => null)) as {
        counts?: number[];
        user_vote?: number | null;
        undo_used?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !Array.isArray(result?.counts)) {
        throw new Error(result?.error ?? "Failed to undo your vote.");
      }
      // Back to the pre-vote state with the one-time undo consumed.
      setPollVoteOverride({ counts: result.counts, userVote: result.user_vote ?? null, undoUsed: result.undo_used === true });
      onPollVoteChanged?.(thread.id, result.counts, result.user_vote ?? null, result.undo_used === true);
    } catch (error) {
      // Keep showing results — the vote stands until the server says otherwise.
      setPollVoteOverride(null);
      showInteractionError(error instanceof Error ? error.message : "Failed to undo your vote.");
    } finally {
      pollVoteBusyRef.current = false;
      setPollVoteBusy(false);
    }
  }

  const authorName = thread.users?.name ?? "Member";
  const dateLabel  = formatRelativeDate(thread.created_at);
  const edited     = isThreadEdited(thread.created_at, thread.updated_at);

  const attachments = Array.isArray(thread.attachments) ? thread.attachments : [];
  const images = attachments.filter((a) => a.type.startsWith("image/"));
  const files  = attachments.filter((a) => !a.type.startsWith("image/"));

  const pollOptionCount = thread.poll?.options.length ?? 0;
  const pollBaseCounts = Array.isArray(thread.poll_vote_counts) && thread.poll_vote_counts.length === pollOptionCount
    ? thread.poll_vote_counts
    : thread.poll ? thread.poll.options.map(() => 0) : [];
  const displayedPollCounts = pollVoteOverride?.counts ?? pollBaseCounts;
  const displayedPollUserVote = pollVoteOverride
    ? pollVoteOverride.userVote
    : (thread.poll_user_vote ?? null);
  const displayedPollUndoUsed = pollVoteOverride
    ? pollVoteOverride.undoUsed
    : (thread.poll_undo_used ?? false);

  const cardClassName = onOpen
    ? `group cursor-pointer ${communityFeedLayout.card} ${communityFeedLayout.cardInteractive}`
    : communityFeedLayout.detailCard;

  function handleCardClick(event: React.MouseEvent<HTMLElement>) {
    if (!onOpen) return;
    const interactiveTarget = (event.target as Element | null)?.closest?.("button, a, [role='link'], [role='button']");
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    onOpen();
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!onOpen || event.key !== "Enter") return;
    const interactiveTarget = (event.target as Element | null)?.closest?.("button, a, [role='link'], [role='button']");
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    event.preventDefault();
    onOpen();
  }

  return (
    <>
      <article
        tabIndex={onOpen ? 0 : undefined}
        role={onOpen ? "link" : undefined}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        className={cardClassName}
      >
        {/* ── Top row: avatar · name · date · category pill · menu ── */}
        <div className="flex items-start justify-between gap-3">
          <PostAuthorMeta
            name={authorName}
            avatarUrl={thread.users?.avatar_url}
            createdAt={thread.created_at}
            dateLabel={dateLabel}
            dateInline
            edited={edited}
            secondaryLabel={`Threads · ${category?.label ?? "Post"}`}
          />

          {/* ··· menu */}
          <div
            className="relative shrink-0"
            ref={menuRef}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((prev) => !prev); }}
              aria-label="Thread options"
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-raised hover:text-foreground"
            >
              <MoreHorizontal strokeWidth={2.5} size={15} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                <button
                  type="button"
                  onClick={(e) => {
                    handleSave(e);
                    setMenuOpen(false);
                  }}
                  aria-pressed={displayedSaved}
                  className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                >
                  <Bookmark strokeWidth={2.5} size={11} fill={displayedSaved ? "currentColor" : "none"} />
                  {displayedSaved ? "Unsave" : "Save"}
                </button>
                {isOwner ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setMenuOpen(false); setShowEditModal(true); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                    >
                      <Pencil strokeWidth={2.5} size={11} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setMenuOpen(false); setConfirmDelete(true); }}
                      disabled={deleting}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                    >
                      <Trash2 strokeWidth={2.5} size={11} />
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
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
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Title ── */}
        {isDetail ? (
          <h1 className="mt-4 whitespace-pre-wrap break-words font-display text-sm font-semibold leading-snug text-foreground">
            {renderWithLinks(thread.title, false)}
          </h1>
        ) : (
          <div className="relative">
            <h3
              ref={titleRef}
              className={`mt-3 whitespace-pre-wrap break-words font-display text-sm font-semibold leading-snug text-foreground ${titleExpanded ? "" : "line-clamp-2 text-clip"}`}
            >
              {renderWithLinks(thread.title, true)}
            </h3>
            {/* "…More" right after the last visible word, on the same line. */}
            {titleOverflow && !titleExpanded && morePos && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTitleExpanded(true); }}
                style={{ left: `${morePos.left}px`, bottom: `${morePos.bottom}px` }}
                className="absolute min-w-12 bg-background-subtle font-body text-xs font-medium leading-snug text-foreground-subtle transition-colors hover:text-accent"
              >
                …More
              </button>
            )}
          </div>
        )}

        {/* ── Poll ── */}
        {thread.poll && (
          <ThreadPollResult
            poll={thread.poll}
            counts={displayedPollCounts}
            userVote={displayedPollUserVote}
            busy={pollVoteBusy}
            canUndo={!displayedPollUndoUsed}
            hideQuestion={thread.poll.question.trim() === thread.title.trim()}
            onVote={(optionIndex) => void handlePollVote(optionIndex)}
            onUndo={() => void handlePollUndo()}
          />
        )}

        {/* ── Attachments ── */}
        {(() => {
          const fileList = files.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {files.map((att) =>
                isDetail ? (
                  <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:border-accent/40 hover:text-accent">
                    <Paperclip strokeWidth={2.5} size={12} />
                    <span className="min-w-0 flex-1 truncate">{att.name}</span>
                    <span className="shrink-0 text-foreground-subtle">{(att.size / 1024).toFixed(0)} KB</span>
                  </a>
                ) : (
                  <div key={att.url} role="link" tabIndex={0}
                    onClick={(e) => { e.preventDefault(); window.open(att.url, "_blank", "noopener,noreferrer"); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); window.open(att.url, "_blank", "noopener,noreferrer"); } }}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:border-accent/40 hover:text-accent">
                    <Paperclip strokeWidth={2.5} size={12} />
                    <span className="min-w-0 flex-1 truncate">{att.name}</span>
                    <span className="shrink-0 text-foreground-subtle">{(att.size / 1024).toFixed(0)} KB</span>
                  </div>
                )
              )}
            </div>
          ) : null;

          if (images.length === 0) return fileList;

          let imageGrid: React.ReactNode = null;

          if (images.length === 1) {
            imageGrid = (
              <div
                role="button"
                tabIndex={0}
                aria-label="Open image viewer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightboxIndex(0); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setLightboxIndex(0); } }}
                className="mt-3 block overflow-hidden rounded-xl border border-border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {/* Native aspect ratio, capped at 480px tall — never cropped. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={images[0].url} alt={images[0].name} draggable={false} className="mx-auto block max-h-[480px] max-w-full w-auto transition-opacity hover:opacity-95" />
              </div>
            );
          } else if (images.length > 1) {
            imageGrid = <ThreadImageCarousel images={images} onImageClick={(i) => setLightboxIndex(i)} />;
          }

          return <>{imageGrid}{fileList}</>;
        })()}

        {interactionError && (
          <p role="status" className="mt-3 font-body text-xs text-red-400">
            {interactionError}
          </p>
        )}

        {/* ── Footer: engagement · community ── */}
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="flex shrink-0 items-center gap-4">
            {/* Like */}
            <button
              type="button"
              onClick={handleLike}
              aria-label={thread.user_liked ? "Unlike" : "Like"}
              aria-pressed={thread.user_liked}
              className="group/like flex cursor-pointer items-center gap-2"
            >
              <HeartIcon
                size={16}
                active={thread.user_liked}
                className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${
                  thread.user_liked
                    ? "text-[var(--ds-blue-700)]"
                    : "text-foreground-subtle group-hover/like:text-white"
                }`}
              />
              <span
                className={`font-body text-sm font-semibold tabular-nums ${
                  thread.user_liked ? "text-[var(--ds-blue-700)]" : "text-foreground-subtle group-hover/like:text-white"
                }`}
              >
                {thread.like_count}
              </span>
            </button>

            {/* Comments */}
            <span className="inline-flex items-center gap-1.5 font-body font-semibold text-xs text-foreground-subtle transition-colors duration-150 hover:text-white">
              <CommentIcon />
              {thread.comment_count}
            </span>
          </div>

          {communityName && communityNamePlacement === "below" && (
            <CommunityPostLabel
              communityId={communityId}
              communityName={communityName}
              communityImage={communityImage}
              className="min-w-0 justify-end text-right"
            />
          )}
        </div>
      </article>

      {showEditModal && (
        <EditThreadModal
          thread={thread}
          communityId={communityId}
          onClose={() => setShowEditModal(false)}
          onUpdated={onUpdated}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete thread?"
        message="This will permanently remove this thread. This cannot be undone."
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />

      {lightboxIndex !== null && (
        <ThreadImageLightbox
          thread={thread}
          communityId={communityId}
          currentUserId={currentUserId}
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onLikeToggle={() => likeCoalescerRef.current?.toggle()}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}
