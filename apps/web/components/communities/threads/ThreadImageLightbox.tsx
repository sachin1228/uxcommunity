"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  MessageCircle,
  X,
} from "lucide-react";
import type { CommunityThread, ThreadAttachment, ThreadComment } from "./types";
import { formatFullDate } from "./threadShared";
import { ThreadPollResult } from "./PollResult";
import { ModalPortal } from "@/components/ui/Modal";
import { Avatar, CommentBox, CommentRow } from "./ThreadComments";

// ── Download helper (mirrors the chat lightbox) ───────────────────────────────

function fileNameForUrl(url: string): string {
  try {
    const name = (new URL(url).pathname.split("/").pop() ?? "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return name || "thread-image";
  } catch {
    return "thread-image";
  }
}

function downloadImage(url: string, fallbackName: string) {
  // Download through our same-origin proxy: the R2 bucket sends no CORS
  // headers, so a direct fetch is blocked and an anchor would navigate. The
  // proxy responds with Content-Disposition: attachment, so the image always
  // downloads and never opens a new tab.
  const a = document.createElement("a");
  a.href = `/api/image-download?url=${encodeURIComponent(url)}`;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Main component ────────────────────────────────────────────────────────────

interface ThreadImageLightboxProps {
  thread: CommunityThread;
  communityId: string;
  currentUserId: string;
  /** Image attachments only (already filtered by the caller). */
  images: ThreadAttachment[];
  /** Image to show first. */
  initialIndex: number;
  onClose: () => void;
  /** Toggles like/unlike (wired to the card's optimistic like logic). */
  onLikeToggle?: () => void;
  /** Syncs the parent (card / feed / detail page) when the comment count changes. */
  onUpdated?: (thread: CommunityThread) => void;
}

/**
 * Full-screen viewer for thread images. Clicking an image on a thread card
 * opens this modal instead of a new tab: the current image is centered with
 * carousel navigation (arrows / thumbnails / keyboard) on the left, and a
 * right sidebar shows the full thread content plus its comments.
 */
export function ThreadImageLightbox({
  thread,
  communityId,
  currentUserId,
  images,
  initialIndex,
  onClose,
  onLikeToggle,
  onUpdated,
}: ThreadImageLightboxProps) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(0, images.length - 1)),
  );
  const [comments, setComments] = useState<ThreadComment[] | null>(null);
  const [commentsError, setCommentsError] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  const goPrev = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((current) => Math.min(images.length - 1, current + 1));
  }, [images.length]);

  // Keyboard navigation (Esc / arrows) + scroll lock while the viewer is open.
  // Arrow keys are ignored while typing in the comment box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goPrev, goNext]);

  // Fetch comments once when the viewer opens.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/communities/${communityId}/threads/${thread.id}/comments`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { comments?: ThreadComment[] } | null) => {
        if (!cancelled && data?.comments) setComments(data.comments);
        else if (!cancelled) setCommentsError(true);
      })
      .catch(() => {
        if (!cancelled) setCommentsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [communityId, thread.id]);

  // Post / reply / delete a comment (same shape as the thread detail page).
  function handleCommentPosted(comment: ThreadComment) {
    setComments((current) => {
      const list = current ?? [];
      return comment.parent_id
        ? list.map((item) => item.id === comment.parent_id
          ? { ...item, replies: [...item.replies.filter((reply) => reply.id !== comment.id), comment] }
          : item)
        : [...list.filter((item) => item.id !== comment.id), { ...comment, replies: [] }];
    });
  }

  function handleCommentDeleted(id: string, parentId: string | null) {
    setComments((current) => {
      const list = current ?? [];
      return parentId
        ? list.map((comment) => comment.id === parentId
          ? { ...comment, replies: comment.replies.filter((reply) => reply.id !== id) }
          : comment)
        : list.filter((comment) => comment.id !== id);
    });
  }

  // Keep the thread (and therefore the feed card / detail page) in sync with
  // the real comment count as comments are posted or deleted.
  useEffect(() => {
    if (comments === null) return;
    const total = comments.reduce((acc, comment) => acc + 1 + comment.replies.length, 0);
    onUpdated?.({ ...thread, comment_count: total });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

  // Keep the active thumbnail in view when navigating.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [index]);

  if (images.length === 0) return null;

  const image = images[index];
  const authorName = thread.users?.name ?? "Member";
  const totalComments = comments
    ? comments.reduce((total, comment) => total + 1 + comment.replies.length, 0)
    : thread.comment_count;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Thread image viewer"
        className="relative flex h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        {/* ── Left: image canvas + carousel ─────────────────────────────── */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-[#151515]">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-16 py-4">
            {index > 0 && (
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft strokeWidth={2.5} size={22} />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.name}
              draggable={false}
              className="max-h-full max-w-full select-none rounded-sm object-contain shadow-2xl"
            />
            {index < images.length - 1 && (
              <button
                type="button"
                onClick={goNext}
                aria-label="Next image"
                className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight strokeWidth={2.5} size={22} />
              </button>
            )}
          </div>

          {images.length > 1 && (
            <div className="shrink-0 border-t border-white/10 px-4 py-3">
              <div ref={stripRef} className="flex overflow-x-auto scrollbar-none px-1 py-1">
                <div className="mx-auto flex w-max items-center gap-2">
                  {images.map((img, i) => (
                    <button
                      key={`${img.url}-${i}`}
                      type="button"
                      onClick={() => setIndex(i)}
                      data-active={i === index}
                      aria-label={`View image ${i + 1} of ${images.length}`}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border transition-all ${
                        i === index
                          ? "border-[var(--ds-blue-700)] ring-2 ring-[var(--ds-blue-700)]"
                          : "border-white/15 opacity-70 hover:opacity-100"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Image actions (always visible, incl. small screens) */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={() => downloadImage(image.url, fileNameForUrl(image.url))}
              aria-label="Download image"
              title="Download"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            >
              <Download strokeWidth={2.5} size={18} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close viewer"
              title="Close (Esc)"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            >
              <X strokeWidth={2.5} size={18} />
            </button>
          </div>
        </div>

        {/* ── Right: thread content + comments ──────────────────────────── */}
        <aside className="hidden w-[380px] shrink-0 flex-col border-l border-border bg-background md:flex">
          {/* Author header */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-3.5">
            <Avatar name={authorName} avatarUrl={thread.users?.avatar_url ?? null} />
            <div className="min-w-0">
              <p className="truncate font-body text-sm font-semibold text-foreground">{authorName}</p>
              <p className="font-body text-[11px] text-foreground-muted">
                {formatFullDate(thread.created_at)} · Threads
              </p>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <h2 className="whitespace-pre-wrap break-words font-display text-[15px] font-semibold leading-snug text-foreground">
              {thread.title}
            </h2>

            {thread.poll && (
              <ThreadPollResult
                poll={thread.poll}
                counts={thread.poll_vote_counts}
                userVote={thread.poll_user_vote}
              />
            )}

            {/* Engagement stats — like button mirrors the thread card design */}
            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                onClick={onLikeToggle}
                disabled={!onLikeToggle}
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
              <span className="inline-flex items-center gap-1.5 font-body font-semibold text-xs text-white">
                <MessageCircle size={20} strokeWidth={2.5} />
                {totalComments}
              </span>
            </div>

            {/* Comments */}
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="font-display text-sm font-semibold text-foreground">
                Comments ({totalComments})
              </h3>

              {comments === null && !commentsError && (
                <p className="mt-4 font-body text-xs text-foreground-subtle" role="status">
                  Loading comments…
                </p>
              )}
              {commentsError && (
                <p className="mt-4 font-body text-xs text-red-400">
                  Couldn&apos;t load comments.
                </p>
              )}
              {comments !== null && !commentsError && (
                <>
                  {thread.allow_replies ? (
                    <div className="mt-3">
                      <CommentBox
                        communityId={communityId}
                        threadId={thread.id}
                        onPosted={handleCommentPosted}
                      />
                    </div>
                  ) : (
                    <div className="mt-3 border-y border-border px-3 py-2.5 text-center font-body text-xs text-foreground-subtle">
                      Replies are closed for this thread.
                    </div>
                  )}

                  {comments.length === 0 ? (
                    <p className="mt-4 font-body text-xs text-foreground-subtle">
                      No comments yet. Be the first!
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
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
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
    </ModalPortal>
  );
}