"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Heart, Bookmark, Flag, MessageSquare,
  MoreHorizontal, Paperclip, Pencil, Trash2,
} from "lucide-react";

import type { CommunityThread } from "./types";
import { THREAD_CATEGORIES } from "./types";
import { communityFeedLayout } from "../feed-layout";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

/** Render text with URLs highlighted blue.
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
          className="text-blue-400 hover:underline break-all cursor-pointer"
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
          className="text-blue-400 hover:underline break-all"
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
import { formatFullDate, formatRelativeDate } from "./threadShared";
import { isPublicContentScope, publicContentHref } from "@/lib/content-scope";
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
  onDeleted: (threadId: string) => void;
  /** When set, shows a small "in CommunityName" badge — used on the profile page */
  communityName?: string;
  communityImage?: string | null;
  /** Controls where the home-feed community label is rendered. */
  communityNamePlacement?: "header" | "below";
  /**
   * "list" (default) — compact card wrapped in a <Link>, used in ThreadsView and ProfileThreads.
   * "detail"          — full expanded view with no link wrapper, used on the thread detail page.
   */
  variant?: "list" | "detail";
  /** Override the link destination (e.g. public standalone detail page). */
  detailHref?: string;
  /** When true, suppresses the bottom border (e.g. last item in a feed list). */
  isLast?: boolean;
  /**
   * "flat" (default) — border-b separator rows, no background (home feed style).
   * "card"           — bg-surface rounded card with gap spacing, no border-b (community threads tab style).
   */
  cardStyle?: "flat" | "card";
}

export function ThreadCard({
  thread,
  currentUserId,
  communityId,
  onUpdated,
  onLikeChanged,
  onSaveChanged,
  onDeleted,
  communityName,
  communityImage,
  communityNamePlacement = "header",
  variant = "list",
  detailHref,
  isLast = false,
  cardStyle = "flat",
}: ThreadCardProps) {
  const isDetail = variant === "detail";
  const category = THREAD_CATEGORIES.find((item) => item.value === thread.category);
  const isOwner = thread.user_id === currentUserId;

  const [optimisticLike, setOptimisticLike] = useState<{ liked: boolean; count: number } | null>(null);
  const optimisticCountRef = useRef(thread.like_count);
  const displayedLikeRef = useRef(thread.user_liked);
  const optimisticLiked = optimisticLike?.liked ?? thread.user_liked;
  const optimisticLikeCount = optimisticLike?.count ?? thread.like_count;
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const displayedSaved = optimisticSaved ?? thread.user_saved;
  const likeCoalescerRef = useRef<BooleanIntentCoalescer | null>(null);
  const saveCoalescerRef = useRef<BooleanIntentCoalescer | null>(null);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [reported, setReported]       = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
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

  function applyLikeState(liked: boolean) {
    if (displayedLikeRef.current === liked) return;
    const newCount = Math.max(0, optimisticCountRef.current + (liked ? 1 : -1));
    displayedLikeRef.current = liked;
    optimisticCountRef.current = newCount;
    setOptimisticLike({ liked, count: newCount });
    onLikeChanged(thread.id, liked, newCount);
  }

  function getLikeCoalescer() {
    if (!likeCoalescerRef.current) {
      likeCoalescerRef.current = new BooleanIntentCoalescer({
        initialValue: displayedLikeRef.current,
        onOptimisticChange: applyLikeState,
        persist: async (liked) => {
          const response = await dedupeFetch(
            `/api/communities/${communityId}/threads/${thread.id}/like`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ liked }),
            },
            { cooldownMode: "url" },
          );
          const result = (await response.json().catch(() => null)) as {
            liked?: boolean;
            count?: number;
            error?: string;
          } | null;
          if (!response.ok || typeof result?.liked !== "boolean") {
            throw new Error(result?.error ?? "Failed to update like.");
          }
          if (typeof result.count === "number") {
            optimisticCountRef.current = result.count;
            setOptimisticLike({ liked: result.liked, count: result.count });
            onLikeChanged(thread.id, result.liked, result.count);
          }
          return result.liked;
        },
        onError: (error) => {
          showInteractionError(error instanceof Error ? error.message : "Failed to update like.");
        },
      });
    }
    return likeCoalescerRef.current;
  }

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
    likeCoalescerRef.current?.dispose();
    saveCoalescerRef.current?.dispose();
    if (interactionErrorTimerRef.current) clearTimeout(interactionErrorTimerRef.current);
  }, []);

  useEffect(() => {
    likeCoalescerRef.current?.syncConfirmed(thread.user_liked);
    if (!likeCoalescerRef.current?.isPending()) {
      displayedLikeRef.current = thread.user_liked;
      optimisticCountRef.current = thread.like_count;
    }
  }, [thread.user_liked, thread.like_count]);

  useEffect(() => {
    saveCoalescerRef.current?.syncConfirmed(thread.user_saved);
  }, [thread.user_saved]);

  function handleSave(e: React.MouseEvent) {
    e.preventDefault();
    getSaveCoalescer().toggle();
  }

  function handleLike(e: React.MouseEvent) {
    e.preventDefault();
    getLikeCoalescer().toggle();
  }

  const authorName    = thread.users?.name ?? "Member";
  const threadHref    = detailHref ?? (isPublicContentScope(communityId)
    ? publicContentHref("thread", thread.id)
    : `/dashboard/communities/${communityId}/threads/${thread.id}`);
  const dateLabel     = isDetail
    ? formatFullDate(thread.created_at)
    : formatRelativeDate(thread.updated_at || thread.created_at);

  // ── Inner content (shared between list and detail) ───────────────────────
  const innerContent = (
    <>
      {/* ── Top row: avatar · name · date · category pill · community · menu ── */}
      <div className="flex items-start justify-between gap-3">
        <PostAuthorMeta
          name={authorName}
          avatarUrl={thread.users?.avatar_url}
          createdAt={thread.updated_at || thread.created_at}
          dateLabel={dateLabel}
          dateInline
          secondaryLabel={`Threads · ${category?.label ?? "Post"}`}
        />

        {/* ··· menu */}
        <div
          className="relative shrink-0"
          ref={menuRef}
          onClick={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setMenuOpen((prev) => !prev); }}
            aria-label="Thread options"
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-raised hover:text-foreground"
          >
            <MoreHorizontal size={15} />
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
                <Bookmark size={11} fill={displayedSaved ? "currentColor" : "none"} />
                {displayedSaved ? "Unsave thread" : "Save thread"}
              </button>
              {isOwner ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setMenuOpen(false); setShowEditModal(true); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                  >
                    <Pencil size={11} /> Edit thread
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setMenuOpen(false); setConfirmDelete(true); }}
                    disabled={deleting}
                    className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    {deleting ? "Deleting…" : "Delete thread"}
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
                  <Flag size={11} />
                  {reported ? "Reported" : "Report thread"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Title + Body ──
          New-format threads store the full body in description (first line = title).
          Old-format threads have a separate title and description.
          When description starts with the title we're in new-format: skip the
          heading and show description directly. */}
      {(() => {
        const newFormat = thread.description.trimStart().startsWith(thread.title.trim());
        if (newFormat) {
          return (
            <p className={`mt-3 font-body text-[15px] font-medium leading-relaxed text-foreground ${isDetail ? "whitespace-pre-wrap" : "line-clamp-4"}`}>
              {renderWithLinks(thread.description, !isDetail)}
            </p>
          );
        }
        return (
          <>
            {isDetail ? (
              <h1 className="mt-4 font-display text-base font-semibold leading-snug text-foreground">
                {thread.title}
              </h1>
            ) : (
              <h3 className="mt-3 font-display text-sm font-semibold leading-snug text-foreground">
                {thread.title}
              </h3>
            )}
            <p className={`mt-1.5 font-body text-xs leading-relaxed text-foreground-muted ${isDetail ? "whitespace-pre-wrap" : "line-clamp-3"}`}>
              {renderWithLinks(thread.description, !isDetail)}
            </p>
          </>
        );
      })()}


      {/* ── Attachments — LinkedIn-style image grid ── */}
      {(() => {
        const images = thread.attachments.filter((a) => a.type.startsWith("image/"));
        const files  = thread.attachments.filter((a) => !a.type.startsWith("image/"));

        const fileList = files.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {files.map((att) =>
              isDetail ? (
                <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:border-accent/40 hover:text-accent">
                  <Paperclip size={12} />
                  <span className="min-w-0 flex-1 truncate">{att.name}</span>
                  <span className="shrink-0 text-foreground-subtle">{(att.size / 1024).toFixed(0)} KB</span>
                </a>
              ) : (
                <div key={att.url} role="link" tabIndex={0}
                  onClick={(e) => { e.preventDefault(); window.open(att.url, "_blank", "noopener,noreferrer"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); window.open(att.url, "_blank", "noopener,noreferrer"); } }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted hover:border-accent/40 hover:text-accent">
                  <Paperclip size={12} />
                  <span className="min-w-0 flex-1 truncate">{att.name}</span>
                  <span className="shrink-0 text-foreground-subtle">{(att.size / 1024).toFixed(0)} KB</span>
                </div>
              )
            )}
          </div>
        ) : null;

        if (images.length === 0) return fileList;

        // Wrap image in an anchor (detail) or a div-with-handler (list, avoids nested <a>)
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

        // 1 image — full width
        if (images.length === 1) {
          imageGrid = (
            <ImgWrap img={images[0]} className="mt-3 block overflow-hidden rounded-xl border border-border cursor-pointer">
              <img src={images[0].url} alt={images[0].name} className="w-full object-cover max-h-[480px] transition-opacity hover:opacity-95" />
            </ImgWrap>
          );
        }

        // 2 images — side by side
        else if (images.length === 2) {
          imageGrid = (
            <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
              {images.map((img) => (
                <ImgWrap key={img.url} img={img} className="block overflow-hidden cursor-pointer">
                  <img src={img.url} alt={img.name} className="h-56 w-full object-cover transition-opacity hover:opacity-95" />
                </ImgWrap>
              ))}
            </div>
          );
        }

        // 3 images — left big (2/3) + right 2 stacked (1/3)
        else if (images.length === 3) {
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
        }

        // 4 images — 2×2 grid
        else if (images.length === 4) {
          imageGrid = (
            <div className="mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded-xl">
              {images.map((img) => (
                <ImgWrap key={img.url} img={img} className="block overflow-hidden cursor-pointer">
                  <img src={img.url} alt={img.name} className="h-44 w-full object-cover transition-opacity hover:opacity-95" />
                </ImgWrap>
              ))}
            </div>
          );
        }

        // 5+ images — top full-width + 4-col bottom row with +N overlay
        else {
          const visible  = images.slice(1, 5);
          const overflow = images.length - 5; // images beyond the 5 shown
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
          {/* Like (Instagram-style heart) */}
          <button
            type="button"
            onClick={handleLike}
            aria-label={optimisticLiked ? "Unlike" : "Like"}
            aria-pressed={optimisticLiked}
            className="group/like flex items-center gap-2"
          >
            <Heart
              size={20}
              strokeWidth={2}
              className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${
                optimisticLiked
                  ? "fill-red-500 text-red-500"
                  : "fill-none text-white"
              }`}
            />
            <span
              className={`font-body text-sm font-semibold tabular-nums ${
                optimisticLiked ? "text-red-500" : "text-white"
              }`}
            >
              {optimisticLikeCount}
            </span>
          </button>

          {/* Comments */}
          <span className="inline-flex items-center gap-1.5 font-body font-semibold text-xs text-white">
            <MessageSquare size={20} strokeWidth={2} />
            {thread.comment_count} {thread.comment_count === 1 ? "comment" : "comments"}
          </span>
        </div>

        {communityName && communityNamePlacement === "below" && (
          <CommunityPostLabel
            communityName={communityName}
            communityImage={communityImage}
            className="min-w-0 justify-end text-right"
          />
        )}
      </div>
    </>
  );

  // ── Outer wrapper differs between list and detail ─────────────────���───────
  return (
    <>
      {isDetail ? (
        <div>
          {innerContent}
        </div>
      ) : cardStyle === "card" ? (
        <article className="group mx-auto w-full max-w-4xl">
          <Link href={threadHref} prefetch={false} className="block rounded-xl bg-surface px-6 py-5">
            {innerContent}
          </Link>
        </article>
      ) : (
        <article className={`group ${isLast ? "" : communityFeedLayout.dividerBottom}`}>
          <Link href={threadHref} prefetch={false} className={`block ${communityFeedLayout.row}`}>
            <div className={communityFeedLayout.content}>
              {innerContent}
            </div>
          </Link>
        </article>
      )}

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
