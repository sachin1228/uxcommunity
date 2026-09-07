"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, CornerDownRight, MoreHorizontal, Paperclip, Smile, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotoEmojiSvg } from "../chat/NotoEmojiSvg";
import { NotoEmojiGrid } from "../chat/EmojiGifPicker";
import type { ThreadComment } from "./types";
import { formatRelativeDate } from "./threadShared";

/**
 * Matches a full emoji grapheme cluster (base + skin tone + keycap + ZWJ
 * sequences + variation selectors) — same pattern the chat composer and
 * message bubbles use, so the composer and the rendered comment agree on
 * what "one emoji" is.
 */
const EMOJI_CLUSTER =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

/** Renders comment text with emoji shown as Noto SVGs, like chat bubbles. */
function renderCommentText(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EMOJI_CLUSTER.lastIndex = 0;
  while ((m = EMOJI_CLUSTER.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <NotoEmojiSvg key={`e${m.index}`} emoji={m[0]} size={16} className="mx-0.5 align-middle" />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  // No emoji found — return the plain string to avoid an extra text node.
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return parts;
}

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  // Close the emoji picker on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (pickerRef.current?.contains(target)) return;
      if (target?.closest?.("[data-comment-emoji-toggle]")) return;
      setPickerOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen]);

  // Auto-grow the input (capped by max-h-36) like the reference composer.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  /** Insert the picked emoji at the textarea caret; keep the picker open so
   *  several emoji can be added in one go (like WhatsApp). */
  function insertEmoji(emoji: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

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
    <div className="relative w-full rounded-2xl border border-border bg-background p-1.5 transition-colors duration-150 focus-within:bg-surface">
    <form onSubmit={submit} className="w-full">
      {/* ── Single row: avatar · input · cancel · actions ── */}
      <div className="flex w-full items-end gap-2">
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
          className="max-h-36 min-w-0 flex-1 resize-none overflow-y-auto break-words bg-transparent py-1.5 text-sm leading-relaxed text-foreground placeholder:text-foreground-subtle focus:outline-none"
        />
        {onCancel && (
          <button type="button" onClick={onCancel} className="shrink-0 pb-1 font-body text-xs text-foreground-subtle hover:text-foreground">
            Cancel
          </button>
        )}
        {/* Action buttons — bottom-aligned so they stay pinned to the last
            input line as it grows */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Image attachment — visual placeholder for now, the comments API
              doesn't accept attachments yet. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="flex h-6 w-6 items-center justify-center rounded-lg border border-border bg-surface text-foreground-subtle transition-colors hover:text-foreground"
          >
            <Paperclip strokeWidth={2.5} size={14} />
          </button>
          {/* Emoji picker — opens the shared Noto emoji grid */}
          <button
            type="button"
            data-comment-emoji-toggle
            onClick={() => setPickerOpen((open) => !open)}
            aria-label="Add emoji"
            aria-expanded={pickerOpen}
            className={`hidden h-6 w-6 items-center justify-center rounded-lg border transition-colors lg:flex ${
              pickerOpen
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-surface text-foreground-subtle hover:text-foreground"
            }`}
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

    {/* ── Emoji picker (rendered outside the form so its buttons never submit) ── */}
    {pickerOpen && (
      <div ref={pickerRef} className="absolute left-0 right-0 top-full z-50 mt-2">
        <div className="flex h-[400px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md">
          <NotoEmojiGrid onSelect={insertEmoji} />
        </div>
      </div>
    )}
    </div>
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
        <p className="mt-1 whitespace-pre-wrap break-words font-body text-sm text-foreground-muted">{renderCommentText(comment.body)}</p>
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