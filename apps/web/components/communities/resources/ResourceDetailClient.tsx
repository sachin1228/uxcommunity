"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark, BookmarkCheck, CornerDownRight, ExternalLink,
  Loader2, MessageSquare, MoreHorizontal, Pencil, Send, Trash2,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { ResourceTypeIcon } from "./resourceTypeIcons";
import type { CommunityResource, ResourceComment } from "./types";
import { RESOURCE_TYPES } from "./types";
import { EditResourceModal } from "./EditResourceModal";

function formatRelativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatFullDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function Avatar({ name, avatarUrl, size = "md" }: { name: string; avatarUrl: string | null; size?: "sm" | "md" }) {
  const initial = name.charAt(0).toUpperCase();
  const dim = size === "sm" ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-xs";
  return (
    <div className={`${dim} shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="font-display font-bold text-accent">{initial}</span>
      )}
    </div>
  );
}

// ── Comment Box ────────────────────────────────────────────────────────────

function CommentBox({
  communityId,
  resourceId,
  parentId,
  placeholder,
  onPosted,
  onCancel,
  autoFocus,
}: {
  communityId: string;
  resourceId: string;
  parentId?: string;
  placeholder?: string;
  onPosted: (comment: ResourceComment) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resourceId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, parent_id: parentId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to post comment.");
      setBody("");
      onPosted(data.comment as ResourceComment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e as unknown as React.FormEvent); }}
        placeholder={placeholder ?? "Write a comment… (⌘↵ to post)"}
        rows={parentId ? 2 : 3}
        maxLength={5000}
        className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent"
      />
      {error && <p className="font-body text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="font-body text-xs text-foreground-subtle hover:text-foreground">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving || !body.trim()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          {saving ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

// ── Single comment row ─────────────────────────────────────────────────────

function CommentRow({
  comment,
  communityId,
  resourceId,
  currentUserId,
  isReply,
  onDeleted,
  onReplied,
}: {
  comment: ResourceComment;
  communityId: string;
  resourceId: string;
  currentUserId: string;
  isReply?: boolean;
  onDeleted: (id: string, parentId: string | null) => void;
  onReplied: (comment: ResourceComment) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      await fetch(`/api/communities/${communityId}/resources/${resourceId}/comments/${comment.id}`, { method: "DELETE" });
      onDeleted(comment.id, comment.parent_id);
    } finally {
      setDeleting(false);
      setMenuOpen(false);
    }
  }

  const name = comment.users?.name ?? "Member";

  return (
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
                <MoreHorizontal size={13} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-6 z-20 min-w-[110px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <p className="mt-1 font-body text-sm text-foreground-muted whitespace-pre-wrap break-words">{comment.body}</p>
        {!isReply && (
          <button
            type="button"
            onClick={() => setReplying((p) => !p)}
            className="mt-1.5 inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle hover:text-accent"
          >
            <CornerDownRight size={11} /> Reply
          </button>
        )}
        {replying && (
          <div className="mt-2">
            <CommentBox
              communityId={communityId}
              resourceId={resourceId}
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
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  resource: CommunityResource;
  initialComments: ResourceComment[];
  currentUserId: string;
  communityId: string;
  communityName: string;
}

export function ResourceDetailClient({ resource: initialResource, initialComments, currentUserId, communityId }: Props) {
  const router = useRouter();
  const [resource, setResource] = useState(initialResource);
  const [comments, setComments] = useState(initialComments);
  const [savePending, setSavePending] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = resource.user_id === currentUserId;
  const typeInfo = RESOURCE_TYPES.find((t) => t.value === resource.resource_type);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}/comments`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments as ResourceComment[]);
      const count = (data.comments as ResourceComment[]).reduce((acc: number, c: ResourceComment) => acc + 1 + (c.replies?.length ?? 0), 0);
      setResource((r) => ({ ...r, comment_count: count }));
    } catch { /* silent */ }
  }, [communityId, resource.id]);

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

    const commentChannel = supabase
      .channel(`resource-comments:${resource.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "resource_comments", filter: `resource_id=eq.${resource.id}` },
        () => void fetchComments(),
      )
      .subscribe();

    const saveChannel = supabase
      .channel(`resource-saves-detail:${resource.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "resource_saves", filter: `resource_id=eq.${resource.id}` },
        (payload) => {
          const record = (payload.new ?? payload.old) as { user_id?: string } | null;
          if (record?.user_id === currentUserId) return;
          setResource((r) => ({
            ...r,
            save_count: payload.eventType === "INSERT" ? r.save_count + 1 : Math.max(0, r.save_count - 1),
          }));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(commentChannel);
      supabase.removeChannel(saveChannel);
    };
  }, [resource.id, currentUserId, fetchComments]);

  async function handleDelete() {
    if (!confirm("Delete this resource? This cannot be undone.")) return;
    setDeleting(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}`, { method: "DELETE" });
      if (res.ok) router.push(`/dashboard/communities/${communityId}?tab=resources`);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (savePending) return;
    const newSaved = !resource.user_saved;
    const newCount = resource.save_count + (newSaved ? 1 : -1);
    setResource((r) => ({ ...r, user_saved: newSaved, save_count: newCount }));
    setSavePending(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}/save`, { method: "POST" });
      if (!res.ok) setResource((r) => ({ ...r, user_saved: !newSaved, save_count: resource.save_count }));
    } catch {
      setResource((r) => ({ ...r, user_saved: !newSaved, save_count: resource.save_count }));
    } finally {
      setSavePending(false);
    }
  }

  function handleCommentPosted(comment: ResourceComment) {
    if (comment.parent_id) {
      setComments((prev) =>
        prev.map((c) => c.id === comment.parent_id ? { ...c, replies: [...(c.replies ?? []), comment] } : c),
      );
    } else {
      setComments((prev) => [...prev, { ...comment, replies: [] }]);
    }
    setResource((r) => ({ ...r, comment_count: r.comment_count + 1 }));
  }

  function handleCommentDeleted(id: string, parentId: string | null) {
    if (parentId) {
      setComments((prev) =>
        prev.map((c) => c.id === parentId ? { ...c, replies: (c.replies ?? []).filter((reply) => reply.id !== id) } : c),
      );
    } else {
      const target = comments.find((c) => c.id === id);
      const removed = 1 + (target?.replies?.length ?? 0);
      setComments((prev) => prev.filter((c) => c.id !== id));
      setResource((r) => ({ ...r, comment_count: Math.max(0, r.comment_count - removed) }));
      return;
    }
    setResource((r) => ({ ...r, comment_count: Math.max(0, r.comment_count - 1) }));
  }

  const authorName = resource.users?.name ?? "Member";
  const totalComments = comments.reduce((acc, c) => acc + 1 + (c.replies?.length ?? 0), 0);

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">

          {/* Resource card */}
          <div className="rounded-xl border border-border bg-surface p-5">
            {/* Top row: type badge + actions */}
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-body text-[10px] text-foreground-muted">
                <ResourceTypeIcon type={resource.resource_type} size={11} />
                {typeInfo?.label ?? resource.resource_type}
              </span>

              <div className="flex items-center gap-2">
                {/* Save / bookmark */}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={savePending}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-body text-xs transition-colors disabled:opacity-60 ${
                    resource.user_saved
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border text-foreground-muted hover:border-accent/40 hover:text-accent"
                  }`}
                >
                  {resource.user_saved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
                  {resource.user_saved ? "Saved" : "Save"}
                  <span className="font-mono text-[10px]">{resource.save_count}</span>
                </button>

                {/* Open link */}
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover"
                >
                  <ExternalLink size={13} />
                  Open
                </a>

                {/* Owner menu */}
                {isOwner && (
                  <div className="relative" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setMenuOpen((p) => !p)}
                      aria-label="Resource options"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {menuOpen && (
                      <div className="absolute right-0 top-9 z-20 min-w-[130px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => { setMenuOpen(false); setShowEdit(true); }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                        >
                          <Pencil size={11} /> Edit resource
                        </button>
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={deleting}
                          className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50"
                        >
                          <Trash2 size={11} />
                          {deleting ? "Deleting…" : "Delete resource"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Title */}
            <h1 className="mt-3 font-display text-lg font-semibold leading-snug text-foreground">
              {resource.title}
            </h1>

            {/* URL display */}
            <a
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-body text-xs text-foreground-muted hover:border-accent/40 hover:text-accent transition-colors"
            >
              <ExternalLink size={11} />
              {getDomain(resource.url)}
            </a>

            {/* Description */}
            {resource.description && (
              <p className="mt-4 font-body text-sm leading-relaxed text-foreground-muted whitespace-pre-wrap">
                {resource.description}
              </p>
            )}

            {/* Tags */}
            {resource.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {resource.tags.map((tag) => (
                  <span key={tag} className="font-body text-[11px] text-foreground-subtle">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Author row */}
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
              <Avatar name={authorName} avatarUrl={resource.users?.avatar_url ?? null} size="sm" />
              <span className="font-body text-xs text-foreground-muted">{authorName}</span>
              <span className="font-body text-[11px] text-foreground-subtle">·</span>
              <span className="font-body text-[11px] text-foreground-subtle">{formatFullDate(resource.created_at)}</span>
              <span className="font-body text-[11px] text-foreground-subtle">·</span>
              <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle">
                <MessageSquare size={11} /> {totalComments} {totalComments === 1 ? "comment" : "comments"}
              </span>
            </div>
          </div>

          {/* Comments section */}
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="font-display text-sm font-semibold text-foreground">
                {totalComments} {totalComments === 1 ? "Comment" : "Comments"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <CommentBox
              communityId={communityId}
              resourceId={resource.id}
              onPosted={handleCommentPosted}
            />

            {comments.length > 0 && (
              <div className="mt-6 space-y-5">
                {comments.map((comment) => (
                  <div key={comment.id} className="space-y-3">
                    <CommentRow
                      comment={comment}
                      communityId={communityId}
                      resourceId={resource.id}
                      currentUserId={currentUserId}
                      onDeleted={handleCommentDeleted}
                      onReplied={handleCommentPosted}
                    />
                    {(comment.replies ?? []).map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        communityId={communityId}
                        resourceId={resource.id}
                        currentUserId={currentUserId}
                        isReply
                        onDeleted={handleCommentDeleted}
                        onReplied={handleCommentPosted}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {comments.length === 0 && (
              <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-10 text-center">
                <MessageSquare size={22} className="mx-auto text-foreground-subtle" />
                <p className="mt-2 font-body text-sm text-foreground-muted">No comments yet. Be the first!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showEdit && (
        <EditResourceModal
          resource={resource}
          communityId={communityId}
          onClose={() => setShowEdit(false)}
          onUpdated={(updated) => setResource((r) => ({ ...r, ...updated }))}
        />
      )}
    </>
  );
}
