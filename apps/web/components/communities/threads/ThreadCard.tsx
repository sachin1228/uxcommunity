"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronUp, MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { CommunityThread } from "./types";
import { THREAD_CATEGORIES } from "./types";
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

interface ThreadCardProps {
  thread: CommunityThread;
  currentUserId: string;
  communityId: string;
  onUpdated: (thread: CommunityThread) => void;
  onVoteChanged: (threadId: string, voted: boolean, newCount: number) => void;
  onDeleted: (threadId: string) => void;
}

export function ThreadCard({
  thread,
  currentUserId,
  communityId,
  onUpdated,
  onVoteChanged,
  onDeleted,
}: ThreadCardProps) {
  const category = THREAD_CATEGORIES.find((item) => item.value === thread.category);
  const isOwner = thread.user_id === currentUserId;

  const [votePending, setVotePending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  async function handleVote() {
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

  const authorName = thread.users?.name ?? "Member";
  const authorInitial = authorName.charAt(0).toUpperCase();
  const threadHref = `/dashboard/communities/${communityId}/threads/${thread.id}`;

  return (
    <>
      <article className="group rounded-xl border border-border bg-surface">
        <div className="flex items-stretch">
          {/* Left — upvote column (not a link) */}
          <div className="flex w-11 shrink-0 flex-col items-center justify-start gap-0.5 px-1 py-3">
            <button
              type="button"
              onClick={handleVote}
              disabled={votePending}
              aria-label={thread.user_voted ? "Remove upvote" : "Upvote"}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-60 ${
                thread.user_voted
                  ? "bg-accent/20 text-accent"
                  : "text-foreground-subtle hover:bg-accent/10 hover:text-accent"
              }`}
            >
              <ChevronUp size={15} strokeWidth={thread.user_voted ? 2.5 : 2} />
            </button>
            <span className={`font-mono text-[11px] font-semibold tabular-nums ${thread.user_voted ? "text-accent" : "text-foreground-muted"}`}>
              {thread.vote_count}
            </span>
          </div>

          {/* Main content — clickable link area */}
          <Link href={threadHref} className="min-w-0 flex-1 py-3 pr-3 block">
            {/* Top row: category + menu */}
            <div className="flex items-center justify-between gap-2">
              {category && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 font-body text-[10px] text-foreground-muted">
                  <span>{category.emoji}</span>
                  {category.label}
                </span>
              )}
              <div
                className="relative ml-auto"
                ref={menuRef}
                onClick={(e) => e.preventDefault()}
              >
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setMenuOpen((prev) => !prev); }}
                  aria-label="Thread options"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-raised hover:text-foreground focus:opacity-100"
                >
                  <MoreHorizontal size={13} />
                </button>
                {menuOpen && isOwner && (
                  <div className="absolute right-0 top-7 z-20 min-w-[130px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setMenuOpen(false); setShowEditModal(true); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                    >
                      <Pencil size={11} />
                      Edit thread
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

            {/* Title */}
            <h3 className="mt-1.5 font-display text-sm font-semibold leading-snug text-foreground">
              {thread.title}
            </h3>

            {/* Description */}
            <p className="mt-1 line-clamp-2 font-body text-xs text-foreground-muted">
              {thread.description}
            </p>

            {/* Image attachments */}
            {(() => {
              const images = thread.attachments.filter((a) => a.type.startsWith("image/"));
              if (images.length === 0) return null;
              const visible = images.slice(0, 4);
              const overflow = images.length - visible.length;
              return (
                <div className="mt-2 flex gap-1.5">
                  {visible.map((img, i) => (
                    <div key={img.url} className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-raised">
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

            {/* Tags */}
            {thread.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {thread.tags.map((tag) => (
                  <span key={tag} className="font-body text-[11px] text-foreground-subtle">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15">
                {thread.users?.avatar_url ? (
                  <img src={thread.users.avatar_url} alt={authorName} className="h-4 w-4 object-cover" />
                ) : (
                  <span className="font-display text-[8px] font-bold text-accent">{authorInitial}</span>
                )}
              </div>
              <span className="font-body text-[11px] text-foreground-muted">{authorName}</span>
              <span className="font-body text-[11px] text-foreground-subtle">·</span>
              <span className="font-body text-[11px] text-foreground-subtle">
                {formatRelativeDate(thread.updated_at || thread.created_at)}
              </span>
              <span className="font-body text-[11px] text-foreground-subtle">·</span>
              <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle">
                <MessageSquare size={10} />
                {thread.comment_count} {thread.comment_count === 1 ? "comment" : "comments"}
              </span>
            </div>
          </Link>
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
    </>
  );
}
