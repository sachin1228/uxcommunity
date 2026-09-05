"use client";

import { useState, useRef, useEffect } from "react";
import {
  Heart, Bookmark, Flag, MessageCircle,
  MoreHorizontal, Paperclip, Pencil, Trash2,
} from "lucide-react";

import type { CommunityThread } from "./types";
import { THREAD_CATEGORIES } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

/** Render text with URLs highlighted in the accent color.
 *  isNested=true → uses <span onClick> to avoid <a> inside <a> (list card wrapper). */
function renderWithLinks(text: string, isNested = false) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const url = match[0];
    if (isNested) {
      parts.push(
        <span
          key={match.index}
          role="link"
          tabIndex={0}
          className="text-accent hover:underline break-all cursor-pointer"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(url, "_blank", "noopener,noreferrer"); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); window.open(url, "_blank", "noopener,noreferrer"); } }}
        >
          {url}
        </span>
      );
    } else {
      parts.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      );
    }
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
import { EditThreadModal } from "./EditThreadModal";
import { ThreadPollResult } from "./PollResult";
import { formatFullDate, formatRelativeDate } from "./threadShared";
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
  onPollVoteChanged?: (threadId: string, counts: number[], userVote: number | null) => void;
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [reported, setReported]       = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [pollVoteBusy, setPollVoteBusy] = useState(false);
  const [pollVotePending, setPollVotePending] = useState<number | null>(null);
  const [pollVoteOverride, setPollVoteOverride] = useState<{ counts: number[]; userVote: number | null } | null>(null);
  const interactionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
  }, [thread.poll_vote_counts, thread.poll_user_vote]);

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
    if (!currentPoll || pollVoteBusy) return;
    const optionCount = currentPoll.options.length;
    if (optionIndex < 0 || optionIndex >= optionCount) return;

    // Votes are final: a user who already voted cannot vote again or change it.
    const currentUserVote = pollVoteOverride ? pollVoteOverride.userVote : (thread.poll_user_vote ?? null);
    if (currentUserVote !== null) return;

    setPollVotePending(optionIndex);
    setPollVoteBusy(true);
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
        error?: string;
      } | null;
      if (!response.ok || !Array.isArray(result?.counts)) {
        throw new Error(result?.error ?? "Failed to record your vote.");
      }
      // Results appear only after the vote is confirmed by the server.
      setPollVoteOverride({ counts: result.counts, userVote: result.user_vote ?? null });
      onPollVoteChanged?.(thread.id, result.counts, result.user_vote ?? null);
    } catch (error) {
      // Stay in the pre-vote state; the user can try again.
      setPollVoteOverride(null);
      showInteractionError(error instanceof Error ? error.message : "Failed to record your vote.");
    } finally {
      setPollVotePending(null);
      setPollVoteBusy(false);
    }
  }

  const authorName = thread.users?.name ?? "Member";
  const dateLabel  = isDetail
    ? formatFullDate(thread.created_at)
    : formatRelativeDate(thread.created_at);

  const pollOptionCount = thread.poll?.options.length ?? 0;
  const pollBaseCounts = Array.isArray(thread.poll_vote_counts) && thread.poll_vote_counts.length === pollOptionCount
    ? thread.poll_vote_counts
    : thread.poll ? thread.poll.options.map(() => 0) : [];
  const displayedPollCounts = pollVoteOverride?.counts ?? pollBaseCounts;
  const displayedPollUserVote = pollVoteOverride
    ? pollVoteOverride.userVote
    : (thread.poll_user_vote ?? null);

  const cardClassName = onOpen
    ? `group cursor-pointer ${communityFeedLayout.card} ${communityFeedLayout.cardInteractive}`
    : communityFeedLayout.detailCard;

  function handleCardClick(event: React.MouseEvent<HTMLElement>) {
    if (!onOpen) return;
    const interactiveTarget = (event.target as Element | null)?.closest?.("button, a, [role='link']");
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    onOpen();
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!onOpen || event.key !== "Enter") return;
    const interactiveTarget = (event.target as Element | null)?.closest?.("button, a, [role='link']");
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
          <h1 className="mt-4 font-display text-base font-semibold leading-snug text-foreground">
            {renderWithLinks(thread.title, false)}
          </h1>
        ) : (
          <h3 className="mt-3 font-display text-sm font-semibold leading-snug text-foreground">
            {renderWithLinks(thread.title, true)}
          </h3>
        )}

        {/* ── Poll ── */}
        {thread.poll && (
          <ThreadPollResult
            poll={thread.poll}
            counts={displayedPollCounts}
            userVote={displayedPollUserVote}
            busy={pollVoteBusy}
            pendingOption={pollVotePending}
            onVote={(optionIndex) => void handlePollVote(optionIndex)}
          />
        )}

        {/* ── Attachments ── */}
        {(() => {
          const attachments = Array.isArray(thread.attachments) ? thread.attachments : [];
          const images = attachments.filter((a) => a.type.startsWith("image/"));
          const files  = attachments.filter((a) => !a.type.startsWith("image/"));

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

          function ImgWrap({ img, children, className }: { img: typeof images[0]; children: React.ReactNode; className?: string }) {
            return isDetail ? (
              <a href={img.url} target="_blank" rel="noopener noreferrer" className={className}>
                {children}
              </a>
            ) : (
              <div
                role="link" tabIndex={0} className={className}
                onClick={(e) => { e.preventDefault(); window.open(img.url, "_blank", "noopener,noreferrer"); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); window.open(img.url, "_blank", "noopener,noreferrer"); } }}
              >
                {children}
              </div>
            );
          }

          let imageGrid: React.ReactNode = null;

          if (images.length === 1) {
            imageGrid = (
              <ImgWrap img={images[0]} className="mt-3 block overflow-hidden rounded-xl border border-border cursor-pointer">
                <img src={images[0].url} alt={images[0].name} className="w-full object-cover max-h-[480px] transition-opacity hover:opacity-95" />
              </ImgWrap>
            );
          } else if (images.length === 2) {
            imageGrid = (
              <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
                {images.map((img) => (
                  <ImgWrap key={img.url} img={img} className="block overflow-hidden cursor-pointer">
                    <img src={img.url} alt={img.name} className="h-56 w-full object-cover transition-opacity hover:opacity-95" />
                  </ImgWrap>
                ))}
              </div>
            );
          } else if (images.length === 3) {
            imageGrid = (
              <div className="mt-3 flex h-64 gap-1 overflow-hidden rounded-xl">
                <ImgWrap img={images[0]} className="block flex-[2] overflow-hidden cursor-pointer">
                  <img src={images[0].url} alt={images[0].name} className="h-full w-full object-cover transition-opacity hover:opacity-95" />
                </ImgWrap>
                <div className="flex flex-1 flex-col gap-1">
                  {images.slice(1).map((img) => (
                    <ImgWrap key={img.url} img={img} className="block flex-1 overflow-hidden cursor-pointer">
                      <img src={img.url} alt={img.name} className="h-full w-full object-cover transition-opacity hover:opacity-95" />
                    </ImgWrap>
                  ))}
                </div>
              </div>
            );
          } else if (images.length === 4) {
            imageGrid = (
              <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
                {images.map((img) => (
                  <ImgWrap key={img.url} img={img} className="block overflow-hidden cursor-pointer">
                    <img src={img.url} alt={img.name} className="h-44 w-full object-cover transition-opacity hover:opacity-95" />
                  </ImgWrap>
                ))}
              </div>
            );
          } else {
            const visible  = images.slice(1, 5);
            const overflow = images.length - 5;
            imageGrid = (
              <div className="mt-3 space-y-1 overflow-hidden rounded-xl">
                <ImgWrap img={images[0]} className="block overflow-hidden cursor-pointer">
                  <img src={images[0].url} alt={images[0].name} className="h-52 w-full object-cover transition-opacity hover:opacity-95" />
                </ImgWrap>
                <div className="grid grid-cols-4 gap-1 h-28">
                  {visible.map((img, i) => (
                    <ImgWrap key={img.url} img={img} className="relative block overflow-hidden cursor-pointer">
                      <img src={img.url} alt={img.name} className="h-full w-full object-cover transition-opacity hover:opacity-95" />
                      {i === visible.length - 1 && overflow > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                          <span className="font-display text-lg font-bold text-white">+{overflow}</span>
                        </div>
                      )}
                    </ImgWrap>
                  ))}
                </div>
              </div>
            );
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
              className="group/like flex items-center gap-2"
            >
              <Heart
                size={20}
                strokeWidth={2.5}
                className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${
                  thread.user_liked
                    ? "fill-red-500 text-red-500"
                    : "fill-none text-white"
                }`}
              />
              <span
                className={`font-body text-sm font-semibold tabular-nums ${
                  thread.user_liked ? "text-red-500" : "text-white"
                }`}
              >
                {thread.like_count}
              </span>
            </button>

            {/* Comments */}
            <span className="inline-flex items-center gap-1.5 font-body font-semibold text-xs text-white">
              <MessageCircle size={20} strokeWidth={2.5} />
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
    </>
  );
}
