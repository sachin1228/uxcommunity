"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ArrowUp, MessageSquare, MoreHorizontal, Pencil, Trash2, Bookmark, Share2 } from "lucide-react";

import type { CommunityThread } from "./types";
import { THREAD_CATEGORIES } from "./types";
import { CategoryIcon } from "./categoryIcons";
import { EditThreadModal } from "./EditThreadModal";

function formatRelativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Per-category color tokens — border, icon, text */
const CATEGORY_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  question:    { border: "#7C3AED", text: "#A78BFA", bg: "rgba(124,58,237,0.10)" },
  discussion:  { border: "#0070F3", text: "#60A5FA", bg: "rgba(0,112,243,0.10)"  },
  idea:        { border: "#D97706", text: "#FCD34D", bg: "rgba(217,119,6,0.10)"  },
  feedback:    { border: "#EA580C", text: "#FB923C", bg: "rgba(234,88,12,0.10)"  },
  referral:    { border: "#16A34A", text: "#4ADE80", bg: "rgba(22,163,74,0.10)"  },
  collaboration:{ border: "#0891B2", text: "#67E8F9", bg: "rgba(8,145,178,0.10)" },
};

interface ThreadCardProps {
  thread: CommunityThread;
  currentUserId: string;
  communityId: string;
  onUpdated: (thread: CommunityThread) => void;
  onVoteChanged: (threadId: string, voted: boolean, newCount: number) => void;
  onDeleted: (threadId: string) => void;
  /** When set, shows a small "in CommunityName" badge — used on the profile page */
  communityName?: string;
}

export function ThreadCard({
  thread,
  currentUserId,
  communityId,
  onUpdated,
  onVoteChanged,
  onDeleted,
  communityName,
}: ThreadCardProps) {
  const category = THREAD_CATEGORIES.find((item) => item.value === thread.category);
  const categoryColor = CATEGORY_COLORS[thread.category] ?? CATEGORY_COLORS["discussion"];
  const isOwner = thread.user_id === currentUserId;

  const [votePending, setVotePending] = useState(false);
  const [menuOpen, setMenuOpen]       = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting]       = useState(false);
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
  const threadHref    = `/dashboard/communities/${communityId}/threads/${thread.id}`;

  return (
    <>
      <article className="group rounded-2xl border border-border bg-surface transition-colors hover:border-border-strong">
        <Link href={threadHref} className="block p-5">

          {/* ── Top row: avatar · name · time · category pill · menu ── */}
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

              {/* Name + time + category */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                <span className="font-body text-xs font-medium text-foreground">{authorName}</span>
                <span className="font-body text-[11px] text-foreground-subtle">
                  {formatRelativeDate(thread.updated_at || thread.created_at)}
                </span>
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
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-raised hover:text-foreground focus:opacity-100"
              >
                <MoreHorizontal size={15} />
              </button>
              {menuOpen && isOwner && (
                <div className="absolute right-0 top-8 z-20 min-w-[130px] rounded-lg border border-border bg-surface py-1 shadow-lg">
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
                </div>
              )}
            </div>
          </div>

          {/* ── Title ── */}
          <h3 className="mt-3 font-display text-sm font-semibold leading-snug text-foreground">
            {thread.title}
          </h3>

          {/* ── Description ── */}
          <p className="mt-1.5 line-clamp-3 font-body text-xs leading-relaxed text-foreground-muted">
            {thread.description}
          </p>

          {/* ── Image attachments ── */}
          {(() => {
            const images = thread.attachments.filter((a) => a.type.startsWith("image/"));
            if (images.length === 0) return null;
            const visible  = images.slice(0, 4);
            const overflow = images.length - visible.length;
            return (
              <div className="mt-3 flex gap-2">
                {visible.map((img, i) => (
                  <div key={img.url} className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-raised">
                    <img src={img.url} alt={img.name} className="h-full w-full object-cover" />
                    {i === visible.length - 1 && overflow > 0 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <span className="font-display text-sm font-semibold text-white">+{overflow}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ── Divider ── */}
          <div className="mt-4 border-t border-border" />

          {/* ── Footer: upvote · comments · bookmark · share ── */}
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

            {/* Spacer */}
            <div className="flex-1" />

            {/* Bookmark */}
            <button
              type="button"
              aria-label="Bookmark"
              onClick={(e) => e.preventDefault()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            >
              <Bookmark size={14} />
            </button>

            {/* Share */}
            <button
              type="button"
              aria-label="Share"
              onClick={(e) => e.preventDefault()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
            >
              <Share2 size={14} />
            </button>
          </div>
        </Link>
      </article>

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
