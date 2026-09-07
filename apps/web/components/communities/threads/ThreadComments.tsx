"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, CornerDownRight, MoreHorizontal, Paperclip, Smile, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ThreadComment } from "./types";
import { formatRelativeDate } from "./threadShared";

// ── Avatar ────────────────────────────────────────────────────────────────────

export function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "sm" | "md" }) {
  const initial = name.charAt(0).toUpperCase();
  const dim = size === "sm" ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-xs";
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

// ── Comment Box ───────────────────────────────────────────────────────────────

// Module-level cache for the current user's avatar — every composer (detail
// page, lightbox, reply boxes) can share a single /api/auth/me round trip.
let cachedMe: { name: string; avatar_url: string | null } | null | undefined;

async function fetchCurrentUser(): Promise<{ name: string; avatar_url: string | null } | null> {
  if (cachedMe !== undefined) return cachedMe;
  try {
    const res = await fetch("/api/auth/me");
    const data = (await res.json().catch(() => null)) as { user?: { name?: string; avatar_url?: string | null } } | null;
    cachedMe = data?.user?.name ? { name: data.user.name, avatar_url: data.user.avatar_url ?? null } : null;
  } catch {
    cachedMe = null;
  }
  return cachedMe;
}

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
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; avatar_url: string | null } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser().then((user) => {
      if (!cancelled) setCurrentUser(user);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-grow the input (capped by max-h-36) like the reference composer.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/threads/${threadId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parent_id: parentId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to post comment.");
      setBody("");
      onPosted(data.comment as ThreadComment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="group w-full rounded-2xl border border-border bg-background p-1.5 transition-colors duration-150 focus-within:bg-surface"
    >
      {/* ── Input row: avatar + text ── */}
      <div className="flex w-full items-center gap-2">
        {currentUser && (
          <div className="hidden shrink-0 self-start sm:block">
            <Avatar name={currentUser.name} avatarUrl={currentUser.avatar_url} size="md" />
          </div>
        )}
        <textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e as unknown as React.FormEvent);
          }}
          placeholder={placeholder ?? "Post your comment"}
          rows={1}
          maxLength={5000}
          className="max-h-36 w-full resize-none overflow-y-auto break-words bg-transparent py-1.5 text-sm leading-relaxed text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
      </div>

      {/* ── Footer: cancel + action buttons ── */}
      <div className={`mt-1.5 flex w-full items-center gap-2 ${onCancel ? "justify-between" : "justify-end"}`}>
        {onCancel && (
          <button type="button" onClick={onCancel} className="font-body text-xs text-foreground-subtle hover:text-foreground">
            Cancel
          </button>
        )}
        <div className="flex items-center gap-2">
          {/* Visual placeholders for now — the comments API doesn't accept
              attachments or emoji yet. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="flex h-6 w-6 items-center justify-center rounded-lg border border-border bg-surface text-foreground-subtle transition-colors hover:text-foreground"
          >
            <Paperclip strokeWidth={2.5} size={14} />
          </button>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="mt-0.5 hidden h-6 w-6 items-center justify-center rounded-lg border border-border bg-surface text-foreground-subtle transition-colors hover:text-foreground lg:flex"
          >
            <Smile strokeWidth={2.5} size={16} />
          </button>
          <button
            type="submit"
            disabled={saving || !body.trim()}
            aria-label={saving ? "Posting…" : "Post comment"}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ds-green-500)] bg-[var(--ds-green-300)] text-white transition-colors hover:border-[var(--ds-green-600)] disabled:cursor-not-allowed disabled:border-[var(--ds-green-400)] disabled:bg-[var(--ds-green-400)]"
          >
            {saving ? <Spinner size={14} className="text-white" /> : <ArrowUp strokeWidth={2.5} size={18} />}
          </button>
        </div>
      </div>

      {error && <p className="mt-1.5 px-1 font-body text-xs text-red-400">{error}</p>}
    </form>
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
        <p className="mt-1 font-body text-sm text-foreground-muted whitespace-pre-wrap break-words">{comment.body}</p>
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