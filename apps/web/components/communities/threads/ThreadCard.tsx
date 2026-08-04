"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  ArrowUp, Bookmark, Flag, MessageSquare,
  MoreHorizontal, Paperclip, Pencil, Share2, Trash2,
} from "lucide-react";

import type { CommunityThread } from "./types";
import { THREAD_CATEGORIES } from "./types";

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
import { CategoryIcon } from "./categoryIcons";
import { EditThreadModal } from "./EditThreadModal";
import { CATEGORY_COLORS, formatRelativeDate, formatFullDate } from "./threadShared";

interface ThreadCardProps {
  thread: CommunityThread;
  currentUserId: string;
  communityId: string;
  onUpdated: (thread: CommunityThread) => void;
  onVoteChanged: (threadId: string, voted: boolean, newCount: number) => void;
  onSaveChanged: (threadId: string, saved: boolean) => void;
  onDeleted: (threadId: string) => void;
  /** When set, shows a small "in CommunityName" badge — used on the profile page */
  communityName?: string;
  /**
   * "list" (default) — compact card wrapped in a <Link>, used in ThreadsView and ProfileThreads.
   * "detail"          — full expanded view with no link wrapper, used on the thread detail page.
   */
  variant?: "list" | "detail";
  /** Override the link destination (e.g. public standalone detail page). */
  detailHref?: string;
  /** When true, suppresses the bottom border (e.g. last item in a feed list). */
  isLast?: boolean;
}

export function ThreadCard({
  thread,
  currentUserId,
  communityId,
  onUpdated,
  onVoteChanged,
  onSaveChanged,
  onDeleted,
  communityName,
  variant = "list",
  detailHref,
  isLast = false,
}: ThreadCardProps) {
  const isDetail = variant === "detail";
  const category = THREAD_CATEGORIES.find((item) => item.value === thread.category);
  const categoryColor = CATEGORY_COLORS[thread.category] ?? CATEGORY_COLORS["discussion"];
  const isOwner = thread.user_id === currentUserId;

  const [votePending, setVotePending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [reported, setReported]       = useState(false);
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

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("Delete this thread? This cannot be undone.")) return;
    setDeleting(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${thread.id}`, { method: "DELETE" });
      if (res.ok) onDeleted(thread.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave(e: React.MouseEvent) {
    e.preventDefault();
    if (savePending) return;
    const newSaved = !thread.user_saved;
    onSaveChanged(thread.id, newSaved);
    setSavePending(true);
    try {
      const response = await fetch(
        `/api/communities/${communityId}/threads/${thread.id}/save`,
        { method: "POST" },
      );
      if (!response.ok) {
        onSaveChanged(thread.id, thread.user_saved);
      }
    } catch {
      onSaveChanged(thread.id, thread.user_saved);
    } finally {
      setSavePending(false);
    }
  }

  async function handleVote(e: React.MouseEvent) {
    e.preventDefault();
    if (votePending) return;
    const newVoted = !thread.user_voted;
    const newCount = thread.vote_count + (newVoted ? 1 : -1);
    onVoteChanged(thread.id, newVoted, newCount);
    setVotePending(true);
    try {
      const response = await fetch(
        `/api/communities/${communityId}/threads/${thread.id}/vote`,
        { method: "POST" },
      );
      if (!response.ok) {
        onVoteChanged(thread.id, thread.user_voted, thread.vote_count);
      }
    } catch {
      onVoteChanged(thread.id, thread.user_voted, thread.vote_count);
    } finally {
      setVotePending(false);
    }
  }

  const authorName    = thread.users?.name ?? "Member";
  const authorInitial = authorName.charAt(0).toUpperCase();
  const threadHref    = detailHref ?? `/dashboard/communities/${communityId}/threads/${thread.id}`;
  const dateLabel     = isDetail
    ? formatFullDate(thread.created_at)
    : formatRelativeDate(thread.updated_at || thread.created_at);

  // ── Inner content (shared between list and detail) ───────────────────────
  const innerContent = (
    <>
      {/* ── Top row: avatar · name · date · category pill · community · menu ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center">
            {thread.users?.avatar_url ? (
              <img src={thread.users.avatar_url} alt={authorName} className="h-9 w-9 object-cover" />
            ) : (
              <span className="font-display text-sm font-bold text-accent">{authorInitial}</span>
            )}
          </div>

          {/* Name + date + category + community */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span className="font-body text-xs font-medium text-foreground">{authorName}</span>
            <span className="font-body text-[11px] text-foreground-subtle">{dateLabel}</span>
            {category && (
              <>
                <span className="font-body text-[11px] text-foreground-subtle">·</span>
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 font-body text-[11px] font-medium"
                  style={{
                    border: `1px solid ${categoryColor.border}`,
                    color: categoryColor.text,
                    background: categoryColor.bg,
                  }}
                >
                  <CategoryIcon category={category.value} size={10} />
                  {category.label}
                </span>
              </>
            )}
            {communityName && (
              <>
                <span className="font-body text-[11px] text-foreground-subtle">·</span>
                <span className="font-body text-[11px] text-foreground-subtle">
                  in <span className="text-foreground-muted">{communityName}</span>
                </span>
              </>
            )}
          </div>
        </div>

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
            <div className="absolute right-0 top-8 z-20 min-w-[130px] rounded-lg border border-border bg-surface py-1 shadow-lg">
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
                    onClick={handleDelete}
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
            <p className={`mt-3 font-body text-sm leading-relaxed text-foreground ${isDetail ? "whitespace-pre-wrap" : "line-clamp-4"}`}>
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


      {/* ── Footer: upvote · comments · (bookmark · share in list only) ── */}
      <div className="mt-3 flex items-center gap-4">
        {/* Upvote */}
        <button
          type="button"
          onClick={handleVote}
          disabled={votePending}
          aria-label={thread.user_voted ? "Remove upvote" : "Upvote"}
          className="flex items-center gap-2 disabled:opacity-60"
        >
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
              thread.user_voted
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                : "border-border text-foreground-subtle hover:border-emerald-500/60 hover:text-emerald-400"
            }`}
          >
            <ArrowUp size={14} strokeWidth={thread.user_voted ? 2.5 : 2} />
          </span>
          <span
            className={`font-body text-xs font-semibold tabular-nums ${
              thread.user_voted ? "text-emerald-400" : "text-foreground-muted"
            }`}
          >
            {thread.vote_count}
          </span>
        </button>

        {/* Comments */}
        <span className="inline-flex items-center gap-1.5 font-body text-xs text-foreground-subtle">
          <MessageSquare size={14} />
          {thread.comment_count} {thread.comment_count === 1 ? "comment" : "comments"}
        </span>

        <div className="flex-1" />

        {/* Bookmark + Share */}
        {!isDetail && (
          <>
            <button
              type="button"
              aria-label={thread.user_saved ? "Unsave thread" : "Save thread"}
              onClick={handleSave}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                thread.user_saved
                  ? "text-emerald-500"
                  : "text-foreground-subtle"
              }`}
            >
              <Bookmark size={14} fill={thread.user_saved ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              aria-label="Share"
              onClick={(e) => { e.preventDefault(); navigator.clipboard?.writeText(window.location.origin + `/dashboard/communities/${communityId}/threads/${thread.id}`).catch(() => {}); }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle hover:text-foreground transition-colors"
            >
              <Share2 size={14} />
            </button>
          </>
        )}
      </div>
    </>
  );

  // ── Outer wrapper differs between list and detail ─────────────────────────
  return (
    <>
      {isDetail ? (
        <div>
          {innerContent}
        </div>
      ) : (
        <article className={`group ${isLast ? "" : "border-b border-border"}`}>
          <Link href={threadHref} className="block px-8 py-6">
            <div className="mx-auto w-full max-w-4xl">
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
    </>
  );
}
