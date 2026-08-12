"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bookmark, Flag, Heart,
  MoreHorizontal, Pencil, Trash2,
} from "lucide-react";
import type { CommunityResource } from "./types";
import { RESOURCE_TYPES } from "./types";
import { ResourceTypeIcon } from "./resourceTypeIcons";
import { EditResourceModal } from "./EditResourceModal";
import { isPublicContentScope } from "@/lib/content-scope";
import { communityFeedLayout } from "../feed-layout";

// Module-level cache — shared across all cards, survives scroll / re-renders
const ogImageCache = new Map<string, string | null>();

function useOgImage(url: string): string | null {
  const [image, setImage] = useState<string | null>(() =>
    ogImageCache.has(url) ? (ogImageCache.get(url) ?? null) : null,
  );

  useEffect(() => {
    if (ogImageCache.has(url)) return;
    const ctrl = new AbortController();
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { image?: string | null } | null) => {
        const img = d?.image ?? null;
        ogImageCache.set(url, img);
        setImage(img);
      })
      .catch(() => {
        ogImageCache.set(url, null);
      });
    return () => ctrl.abort();
  }, [url]);

  return image;
}

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

/** Per-type color tokens — border, icon/text, background tint */
const TYPE_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  figma:       { border: "#7C3AED", text: "#A78BFA", bg: "rgba(124,58,237,0.10)" },
  article:     { border: "#0070F3", text: "#60A5FA", bg: "rgba(0,112,243,0.10)"  },
  tool:        { border: "#EA580C", text: "#FB923C", bg: "rgba(234,88,12,0.10)"  },
  video:       { border: "#DC2626", text: "#F87171", bg: "rgba(220,38,38,0.10)"  },
  book:        { border: "#D97706", text: "#FCD34D", bg: "rgba(217,119,6,0.10)"  },
  font:        { border: "#0891B2", text: "#67E8F9", bg: "rgba(8,145,178,0.10)"  },
  icon_pack:   { border: "#16A34A", text: "#4ADE80", bg: "rgba(22,163,74,0.10)"  },
  color:       { border: "#DB2777", text: "#F472B6", bg: "rgba(219,39,119,0.10)" },
  template:    { border: "#4F46E5", text: "#818CF8", bg: "rgba(79,70,229,0.10)"  },
  inspiration: { border: "#CA8A04", text: "#FDE047", bg: "rgba(202,138,4,0.10)"  },
  other:       { border: "#525252", text: "#A3A3A3", bg: "rgba(82,82,82,0.10)"   },
};

interface ResourceCardProps {
  resource: CommunityResource;
  currentUserId: string;
  communityId: string;
  onUpdated: (resource: CommunityResource) => void;
  onSaveChanged: (resourceId: string, saved: boolean, newCount: number) => void;
  onBookmarkChanged: (resourceId: string, bookmarked: boolean, newCount: number) => void;
  onDeleted: (resourceId: string) => void;
  /** Extends the row divider to the bounds of the scrollable center column. */
  edgeToEdgeDivider?: boolean;
}

export function ResourceCard({
  resource,
  currentUserId,
  communityId,
  onUpdated,
  onSaveChanged,
  onBookmarkChanged,
  onDeleted,
  edgeToEdgeDivider = false,
}: ResourceCardProps) {
  const typeInfo   = RESOURCE_TYPES.find((t) => t.value === resource.resource_type);
  const typeColor  = TYPE_COLORS[resource.resource_type] ?? TYPE_COLORS["other"];
  const isOwner    = resource.user_id === currentUserId;
  const ogImage    = useOgImage(resource.url);

  const [optimisticSave, setOptimisticSave] = useState<{ saved: boolean; count: number } | null>(null);
  const confirmedSaveRef = useRef(resource.user_saved);
  const desiredSaveRef = useRef(resource.user_saved);
  const optimisticSaveCountRef = useRef(resource.save_count);
  const saveRequestRunningRef = useRef(false);
  const displayedSaved = optimisticSave?.saved ?? resource.user_saved;
  const displayedSaveCount = optimisticSave?.count ?? resource.save_count;

  const [optimisticBookmark, setOptimisticBookmark] = useState<{ bookmarked: boolean; count: number } | null>(null);
  const confirmedBookmarkRef = useRef(resource.user_bookmarked);
  const desiredBookmarkRef = useRef(resource.user_bookmarked);
  const optimisticBookmarkCountRef = useRef(resource.bookmark_count);
  const bookmarkRequestRunningRef = useRef(false);
  const displayedBookmarked = optimisticBookmark?.bookmarked ?? resource.user_bookmarked;
  const displayedBookmarkCount = optimisticBookmark?.count ?? resource.bookmark_count;

  const [menuOpen, setMenuOpen]               = useState(false);
  const [showEditModal, setShowEditModal]     = useState(false);
  const [deleting, setDeleting]               = useState(false);
  const [reported, setReported]               = useState(false);
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
    e.preventDefault(); e.stopPropagation();
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

  async function flushSaveIntent() {
    if (saveRequestRunningRef.current) return;
    saveRequestRunningRef.current = true;

    try {
      while (confirmedSaveRef.current !== desiredSaveRef.current) {
        const response = await fetch(
          `/api/communities/${communityId}/resources/${resource.id}/save`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error("Failed to update resource like");

        const result = (await response.json()) as { saved: boolean };
        confirmedSaveRef.current = result.saved;
      }
    } catch {
      desiredSaveRef.current = confirmedSaveRef.current;
      const rollbackCount = Math.max(
        0,
        optimisticSaveCountRef.current + (confirmedSaveRef.current ? 1 : -1),
      );
      optimisticSaveCountRef.current = rollbackCount;
      setOptimisticSave({ saved: confirmedSaveRef.current, count: rollbackCount });
      onSaveChanged(resource.id, confirmedSaveRef.current, rollbackCount);
    } finally {
      saveRequestRunningRef.current = false;
      setOptimisticSave(null);
    }
  }

  function handleSave(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();

    const newSaved = !desiredSaveRef.current;
    const newCount = Math.max(
      0,
      optimisticSaveCountRef.current + (newSaved ? 1 : -1),
    );
    desiredSaveRef.current = newSaved;
    optimisticSaveCountRef.current = newCount;
    setOptimisticSave({ saved: newSaved, count: newCount });
    onSaveChanged(resource.id, newSaved, newCount);
    void flushSaveIntent();
  }

  async function flushBookmarkIntent() {
    if (bookmarkRequestRunningRef.current) return;
    bookmarkRequestRunningRef.current = true;

    try {
      while (confirmedBookmarkRef.current !== desiredBookmarkRef.current) {
        const response = await fetch(
          `/api/communities/${communityId}/resources/${resource.id}/bookmark`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error("Failed to update resource bookmark");

        const result = (await response.json()) as { bookmarked: boolean; bookmark_count: number };
        confirmedBookmarkRef.current = result.bookmarked;
        optimisticBookmarkCountRef.current = result.bookmark_count;
      }
    } catch {
      desiredBookmarkRef.current = confirmedBookmarkRef.current;
      const rollbackCount = Math.max(
        0,
        optimisticBookmarkCountRef.current + (confirmedBookmarkRef.current ? 1 : -1),
      );
      optimisticBookmarkCountRef.current = rollbackCount;
      setOptimisticBookmark({ bookmarked: confirmedBookmarkRef.current, count: rollbackCount });
      onBookmarkChanged(resource.id, confirmedBookmarkRef.current, rollbackCount);
    } finally {
      bookmarkRequestRunningRef.current = false;
      setOptimisticBookmark(null);
    }
  }

  function handleBookmark(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();

    const newBookmarked = !desiredBookmarkRef.current;
    const newCount = Math.max(
      0,
      optimisticBookmarkCountRef.current + (newBookmarked ? 1 : -1),
    );
    desiredBookmarkRef.current = newBookmarked;
    optimisticBookmarkCountRef.current = newCount;
    setOptimisticBookmark({ bookmarked: newBookmarked, count: newCount });
    onBookmarkChanged(resource.id, newBookmarked, newCount);
    void flushBookmarkIntent();
  }

  const authorName    = resource.users?.name ?? "Member";
  const authorInitial = authorName.charAt(0).toUpperCase();

  return (
    <>
      <article className={`group cursor-pointer py-6 ${edgeToEdgeDivider ? communityFeedLayout.dividerBottom : "border-b border-border"}`}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href={resource.url} target="_blank" rel="noopener noreferrer">

          {/* ── Top row: avatar · name · time · type pill · menu ── */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Avatar */}
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-accent/15 flex items-center justify-center">
                {resource.users?.avatar_url ? (
                  <img src={resource.users.avatar_url} alt={authorName} className="h-9 w-9 object-cover" />
                ) : (
                  <span className="font-display text-sm font-bold text-accent">{authorInitial}</span>
                )}
              </div>

              {/* Name + time + type pill */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                <span className="font-body text-xs font-medium text-foreground">{authorName}</span>
                <span className="font-body text-[11px] text-foreground-subtle">
                  {formatRelativeDate(resource.created_at)}
                </span>
                <span className="font-body text-[11px] text-foreground-subtle">·</span>
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 font-body text-[11px] font-medium"
                  style={{
                    border: `1px solid ${typeColor.border}`,
                    color: typeColor.text,
                    background: typeColor.bg,
                  }}
                >
                  <ResourceTypeIcon type={resource.resource_type} size={10} />
                  {typeInfo?.label ?? resource.resource_type}
                </span>
              </div>
            </div>

            {/* ··· menu */}
            <div
              className="relative shrink-0"
              ref={menuRef}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            >
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((p) => !p); }}
                aria-label="Resource options"
                className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-raised hover:text-foreground"
              >
                <MoreHorizontal size={15} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                  {isOwner ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); setShowEditModal(true); }}
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
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setMenuOpen(false);
                        setReported(true);
                        setTimeout(() => setReported(false), 3000);
                      }}
                      disabled={reported}
                      className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
                    >
                      <Flag size={11} />
                      {reported ? "Reported" : "Report resource"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Title ── */}
          <h3 className="mt-3 font-display text-sm font-semibold leading-snug text-foreground">
            {resource.title}
          </h3>

          {/* ── Description ── */}
          {resource.description && (
            <p className="mt-1.5 line-clamp-2 font-body text-xs leading-relaxed text-foreground-muted">
              {resource.description}
            </p>
          )}

          {/* ── Domain label ── */}
          <p className="mt-2 font-body text-[11px] text-foreground-subtle">
            {getDomain(resource.url)}
          </p>

          {/* ── OG image ── */}
          {ogImage && (
            <div className="mt-4 h-52 w-full overflow-hidden rounded-xl bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ogImage}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
              />
            </div>
          )}

          {/* ── Footer: like · bookmark ── */}
          <div className="mt-3 flex items-center gap-4">
            {/* Heart / like */}
            <button
              type="button"
              onClick={handleSave}
              aria-label={displayedSaved ? "Unlike" : "Like"}
              aria-pressed={displayedSaved}
              className="group/like flex items-center gap-2"
            >
              <Heart
                size={20}
                strokeWidth={2}
                className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${
                  displayedSaved
                    ? "fill-red-500 text-red-500"
                    : "fill-none text-white"
                }`}
              />
              <span className={`font-body text-sm font-semibold tabular-nums ${displayedSaved ? "text-red-500" : "text-white"}`}>
                {displayedSaveCount}
              </span>
            </button>

            {/* Bookmark / save */}
            <button
              type="button"
              onClick={handleBookmark}
              aria-label={displayedBookmarked ? "Remove bookmark" : "Bookmark"}
              aria-pressed={displayedBookmarked}
              className="group/save flex items-center gap-2 text-white"
            >
              <Bookmark
                size={20}
                strokeWidth={2}
                fill={displayedBookmarked ? "currentColor" : "none"}
                className="transition-transform duration-150 ease-out group-hover/save:scale-110"
              />
              <span className="font-body text-sm font-semibold tabular-nums">
                {displayedBookmarkCount}
              </span>
            </button>

            <div className="flex-1" />
          </div>
        </a>
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
