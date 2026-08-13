"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bookmark, Flag, Heart,
  MoreHorizontal, Pencil, Trash2,
} from "lucide-react";
import type { CommunityResource } from "./types";
import { RESOURCE_TYPES } from "./types";
import { EditResourceModal } from "./EditResourceModal";
import { isPublicContentScope } from "@/lib/content-scope";
import { communityFeedLayout } from "../feed-layout";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { FigmaEmbed } from "./FigmaEmbed";
import { getFigmaEmbedUrl } from "@/lib/communities/figma";

// Module-level cache — shared across all cards, survives scroll / re-renders
const ogImageCache = new Map<string, string | null>();

function useOgImage(url: string, enabled: boolean): string | null {
  const [image, setImage] = useState<string | null>(() =>
    enabled && ogImageCache.has(url) ? (ogImageCache.get(url) ?? null) : null,
  );

  useEffect(() => {
    if (!enabled || ogImageCache.has(url)) return;
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
  }, [enabled, url]);

  return image;
}

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
  /** Lets a parent list render the divider outside the card gutters. */
  hideDivider?: boolean;
  communityName?: string;
  communityImage?: string | null;
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
  hideDivider = false,
  communityName,
  communityImage,
}: ResourceCardProps) {
  const typeInfo = RESOURCE_TYPES.find((t) => t.value === resource.resource_type);
  const isOwner = resource.user_id === currentUserId;
  const hasFigmaPrototype = getFigmaEmbedUrl(resource.url) !== null;
  const ogImage = useOgImage(resource.url, !hasFigmaPrototype);

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

  return (
    <>
      <article
        className={`group cursor-pointer py-6 ${
          hideDivider
            ? ""
            : edgeToEdgeDivider
              ? communityFeedLayout.dividerBottom
              : "border-b border-border"
        }`}
      >
        <div>
          {/* ── Top row: avatar · name · time · type pill · menu ── */}
          <div className="flex items-start justify-between gap-3">
            <PostAuthorMeta
              name={resource.users?.name}
              avatarUrl={resource.users?.avatar_url}
              createdAt={resource.created_at}
              dateInline
              secondaryLabel={`Resources · ${typeInfo?.label ?? "Post"}`}
            />

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

          {/* ── Description ── */}
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className="block">
            <h3 className="mt-3 line-clamp-3 whitespace-pre-wrap font-display text-sm font-semibold leading-snug text-foreground">
              {resource.description || resource.title}
            </h3>
          </a>

          {/* ── Interactive prototype / OG image ── */}
          {hasFigmaPrototype ? (
            <FigmaEmbed url={resource.url} compact className="mt-4" />
          ) : ogImage ? (
            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="mt-4 block h-52 w-full overflow-hidden rounded-xl bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ogImage}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
              />
            </a>
          ) : null}

          {communityName && (
            <CommunityPostLabel
              communityName={communityName}
              communityImage={communityImage}
              className="mt-3"
            />
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

            <div className="flex-1" />

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
          </div>
        </div>
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
