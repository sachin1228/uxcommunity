"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownRight, MoreHorizontal, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Avatar, CommentComposer, renderEmojiText } from "../CommentComposer";
import type { ThreadComment } from "./types";
import { formatRelativeDate } from "./threadShared";

// Re-exported for consumers (ThreadDetailClient) that import Avatar here.
export { Avatar };

// ── Comment Box ───────────────────────────────────────────────────────────────

export function CommentBox({
  communityId,
  threadId,
  parentId,
  placeholder,
  onPosted,
  onCancel,
  autoFocus,
}: {
  communityId: string;
  threadId: string;
  parentId?: string;
  placeholder?: string;
  onPosted: (comment: ThreadComment) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <CommentComposer
      communityId={communityId}
      kind="threads"
      targetId={threadId}
      parentId={parentId}
      placeholder={placeholder}
      onPosted={(comment) => onPosted(comment as ThreadComment)}
      onCancel={onCancel}
      autoFocus={autoFocus}
    />
  );
}

// ── Single comment row ────────────────────────────────────────────────────────

export function CommentRow({
  comment,
  communityId,
  threadId,
  currentUserId,
  allowReplies,
  isReply,
  onDeleted,
  onReplied,
}: {
  comment: ThreadComment;
  communityId: string;
  threadId: string;
  currentUserId: string;
  allowReplies: boolean;
  isReply?: boolean;
  onDeleted: (id: string, parentId: string | null) => void;
  onReplied: (comment: ThreadComment) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = comment.user_id === currentUserId;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/communities/${communityId}/threads/${threadId}/comments/${comment.id}`, { method: "DELETE" });
      onDeleted(comment.id, comment.parent_id);
    } finally {
      setDeleting(false);
      setMenuOpen(false);
    }
  }

  const name = comment.users?.name ?? "Member";

  return (
    <>
    <div className={`flex gap-2.5 ${isReply ? "pl-8" : ""}`}>
      <Avatar name={name} avatarUrl={comment.users?.avatar_url ?? null} size={isReply ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-body text-xs font-semibold text-foreground">{name}</span>
          <span className="font-body text-[11px] text-foreground-subtle">{formatRelativeDate(comment.created_at)}</span>
          {isOwner && (
            <div className="relative ml-auto" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((p) => !p)}
                className="flex h-5 w-5 items-center justify-center rounded text-foreground-subtle hover:text-foreground"
                aria-label="Comment options"
              >
                <MoreHorizontal strokeWidth={2.5} size={13} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-6 z-20 min-w-[110px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                    disabled={deleting}
                    className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                  >
                    <Trash2 strokeWidth={2.5} size={11} />
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm text-foreground-muted">{renderEmojiText(comment.body)}</p>
        {allowReplies && !isReply && (
          <button
            type="button"
            onClick={() => setReplying((p) => !p)}
            className="mt-1.5 inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle hover:text-accent"
          >
            <CornerDownRight strokeWidth={2.5} size={11} />
            Reply
          </button>
        )}
        {replying && (
          <div className="mt-2">
            <CommentBox
              communityId={communityId}
              threadId={threadId}
              parentId={comment.id}
              placeholder="Write a reply…"
              autoFocus
              onPosted={(c) => { onReplied(c); setReplying(false); }}
              onCancel={() => setReplying(false)}
            />
          </div>
        )}
      </div>
    </div>
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
