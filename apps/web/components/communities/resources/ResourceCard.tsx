"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Bookmark, BookmarkCheck, ExternalLink, MessageSquare,
  MoreHorizontal, Pencil, Trash2,
} from "lucide-react";
import type { CommunityResource } from "./types";
import { RESOURCE_TYPES } from "./types";
import { ResourceTypeIcon } from "./resourceTypeIcons";
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

function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

interface ResourceCardProps {
  resource: CommunityResource;
  currentUserId: string;
  communityId: string;
  onUpdated: (resource: CommunityResource) => void;
  onSaveChanged: (resourceId: string, saved: boolean, newCount: number) => void;
  onDeleted: (resourceId: string) => void;
}

export function ResourceCard({
  resource,
  currentUserId,
  communityId,
  onUpdated,
  onSaveChanged,
  onDeleted,
}: ResourceCardProps) {
  const typeInfo = RESOURCE_TYPES.find((t) => t.value === resource.resource_type);
  const isOwner = resource.user_id === currentUserId;

  const [savePending, setSavePending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("Delete this resource? This cannot be undone.")) return;
    setDeleting(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}`, { method: "DELETE" });
      if (res.ok) onDeleted(resource.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave(e: React.MouseEvent) {
    e.preventDefault();
    if (savePending) return;
    const newSaved = !resource.user_saved;
    const newCount = resource.save_count + (newSaved ? 1 : -1);
    onSaveChanged(resource.id, newSaved, newCount);
    setSavePending(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/resources/${resource.id}/save`, { method: "POST" });
      if (!res.ok) onSaveChanged(resource.id, resource.user_saved, resource.save_count);
    } catch {
      onSaveChanged(resource.id, resource.user_saved, resource.save_count);
    } finally {
      setSavePending(false);
    }
  }

  const authorName = resource.users?.name ?? "Member";
  const authorInitial = authorName.charAt(0).toUpperCase();
  const resourceHref = `/dashboard/communities/${communityId}/resources/${resource.id}`;

  return (
    <>
      <article className="group rounded-xl border border-border bg-surface hover:border-border/80 transition-colors">
        <Link href={resourceHref} className="block p-4">
          {/* Top row: type badge + menu */}
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-body text-[10px] text-foreground-muted">
              <ResourceTypeIcon type={resource.resource_type} size={11} />
              {typeInfo?.label ?? resource.resource_type}
            </span>

            <div
              className="relative ml-auto flex items-center gap-1"
              onClick={(e) => e.preventDefault()}
            >
              {/* Save button */}
              <button
                type="button"
                onClick={handleSave}
                disabled={savePending}
                aria-label={resource.user_saved ? "Remove bookmark" : "Bookmark"}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-60 ${
                  resource.user_saved
                    ? "text-accent"
                    : "text-foreground-subtle opacity-0 group-hover:opacity-100 hover:text-accent"
                }`}
              >
                {resource.user_saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
              </button>

              {/* 3-dot menu */}
              <div ref={menuRef}>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setMenuOpen((p) => !p); }}
                  aria-label="Resource options"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-raised hover:text-foreground focus:opacity-100"
                >
                  <MoreHorizontal size={13} />
                </button>
                {menuOpen && isOwner && (
                  <div className="absolute right-0 top-8 z-20 min-w-[130px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setMenuOpen(false); setShowEditModal(true); }}
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
            </div>
          </div>

          {/* Title */}
          <h3 className="mt-2 font-display text-sm font-semibold leading-snug text-foreground">
            {resource.title}
          </h3>

          {/* Description */}
          {resource.description && (
            <p className="mt-1 line-clamp-2 font-body text-xs text-foreground-muted">
              {resource.description}
            </p>
          )}

          {/* URL pill */}
          <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-body text-[11px] text-foreground-subtle">
            <ExternalLink size={10} />
            <span className="truncate max-w-[200px]">{getDomain(resource.url)}</span>
          </div>

          {/* Tags */}
          {resource.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {resource.tags.map((tag) => (
                <span key={tag} className="font-body text-[11px] text-foreground-subtle">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15">
              {resource.users?.avatar_url ? (
                <img src={resource.users.avatar_url} alt={authorName} className="h-4 w-4 object-cover" />
              ) : (
                <span className="font-display text-[8px] font-bold text-accent">{authorInitial}</span>
              )}
            </div>
            <span className="font-body text-[11px] text-foreground-muted">{authorName}</span>
            <span className="font-body text-[11px] text-foreground-subtle">·</span>
            <span className="font-body text-[11px] text-foreground-subtle">
              {formatRelativeDate(resource.created_at)}
            </span>
            <span className="font-body text-[11px] text-foreground-subtle">·</span>
            <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle">
              <Bookmark size={10} />
              {resource.save_count} {resource.save_count === 1 ? "save" : "saves"}
            </span>
            <span className="font-body text-[11px] text-foreground-subtle">·</span>
            <span className="inline-flex items-center gap-1 font-body text-[11px] text-foreground-subtle">
              <MessageSquare size={10} />
              {resource.comment_count} {resource.comment_count === 1 ? "comment" : "comments"}
            </span>
          </div>
        </Link>
      </article>

      {showEditModal && (
        <EditResourceModal
          resource={resource}
          communityId={communityId}
          onClose={() => setShowEditModal(false)}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}
