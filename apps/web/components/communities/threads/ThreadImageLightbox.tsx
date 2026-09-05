"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Heart,
  MessageCircle,
  X,
} from "lucide-react";
import type { CommunityThread, ThreadAttachment, ThreadComment } from "./types";
import { THREAD_CATEGORIES } from "./types";
import { formatFullDate, formatRelativeDate } from "./threadShared";
import { ThreadPollResult } from "./PollResult";

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "sm" | "md" }) {
  const initial = name.charAt(0).toUpperCase();
  const dim = size === "sm" ? "h-6 w-6 text-[9px]" : "h-9 w-9 text-xs";
  return (
    <div className={`${dim} shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center`}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="font-display font-bold text-accent">{initial}</span>
      )}
    </div>
  );
}

// ── Read-only comment row (matches the thread detail page, minus actions) ─────

function CommentRow({ comment, isReply = false }: { comment: ThreadComment; isReply?: boolean }) {
  const name = comment.users?.name ?? "Member";
  return (
    <div className={`flex gap-2.5 ${isReply ? "pl-8" : ""}`}>
      <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size={isReply ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-body text-xs font-semibold text-foreground">{name}</span>
          <span className="font-body text-[11px] text-foreground-subtle">{formatRelativeDate(comment.created_at)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm text-foreground-muted">{comment.body}</p>
        {comment.replies.map((reply) => (
          <div key={reply.id} className="mt-3">
            <CommentRow comment={reply} isReply />
          </div>
        ))}
      </div>
    </div>
  );
}

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

async function downloadImage(url: string, fallbackName: string) {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface ThreadImageLightboxProps {
  thread: CommunityThread;
  communityId: string;
  /** Image attachments only (already filtered by the caller). */
  images: ThreadAttachment[];
  /** Image to show first. */
  initialIndex: number;
  onClose: () => void;
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
  images,
  initialIndex,
  onClose,
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
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

  // Keep the active thumbnail in view when navigating.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [index]);

  if (images.length === 0) return null;

  const image = images[index];
  const category = THREAD_CATEGORIES.find((item) => item.value === thread.category);
  const authorName = thread.users?.name ?? "Member";
  const totalComments = comments
    ? comments.reduce((total, comment) => total + 1 + comment.replies.length, 0)
    : thread.comment_count;

  return (
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
              <div ref={stripRef} className="flex items-center justify-between gap-4">
                <span className="shrink-0 font-body text-xs tabular-nums text-white/70" role="status">
                  Image {index + 1} of {images.length}
                </span>
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none">
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
            {category && (
              <span className="ml-auto shrink-0 rounded-full border border-border px-2.5 py-0.5 font-body text-[11px] text-foreground-muted">
                {category.label}
              </span>
            )}
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

            {/* Engagement stats */}
            <div className="mt-4 flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 font-body text-sm font-semibold tabular-nums text-foreground">
                <Heart
                  strokeWidth={2.5}
                  size={16}
                  className={thread.user_liked ? "fill-red-500 text-red-500" : "text-foreground"}
                />
                {thread.like_count}
              </span>
              <span className="inline-flex items-center gap-1.5 font-body text-sm font-semibold tabular-nums text-foreground">
                <MessageCircle strokeWidth={2.5} size={16} className="text-foreground" />
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
              {comments && comments.length === 0 && (
                <p className="mt-4 font-body text-xs text-foreground-subtle">
                  No comments yet.
                </p>
              )}
              {comments && comments.length > 0 && (
                <div className="mt-4 space-y-4">
                  {comments.map((comment) => (
                    <CommentRow key={comment.id} comment={comment} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer: full thread link */}
          <div className="shrink-0 border-t border-border p-3">
            <a
              href={`/dashboard/communities/${communityId}/threads/${thread.id}`}
              onClick={onClose}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 font-body text-xs font-medium text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              View full thread
              <ExternalLink strokeWidth={2.5} size={12} />
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}