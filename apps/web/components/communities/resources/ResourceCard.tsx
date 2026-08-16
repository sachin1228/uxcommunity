"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bookmark, BookmarkCheck, ExternalLink, Flag, Heart,
  MoreHorizontal, Pencil, Trash2,
} from "lucide-react";
import type { CommunityResource } from "./types";
import { RESOURCE_TYPES } from "./types";
import { EditResourceModal } from "./EditResourceModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { communityFeedLayout } from "../feed-layout";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { FigmaEmbed } from "./FigmaEmbed";
import { getFigmaEmbedUrl } from "@/lib/communities/figma";
import {
  fetchLinkPreview,
  getCachedLinkPreview,
  hasFreshLinkPreview,
} from "@/lib/communities/linkPreviewCache";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { usePendingMutation } from "@/lib/use-mutation";

function useOgImage(url: string, enabled: boolean): string | null {
  const [image, setImage] = useState<string | null>(() =>
    enabled ? (getCachedLinkPreview(url)?.image ?? null) : null,
  );

  useEffect(() => {
    if (!enabled || hasFreshLinkPreview(url)) return;
    let cancelled = false;
    void fetchLinkPreview(url).then((result) => {
      if (!cancelled) setImage(result.data?.image ?? null);
    });
    return () => { cancelled = true; };
  }, [enabled, url]);

  return image;
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
  onBookmarkChanged: (resourceId: string, bookmarked: boolean, newCount: number) => void;
  onDeleted: (resourceId: string) => void;
  variant?: "list" | "detail";
  edgeToEdgeDivider?: boolean;
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
  variant = "list",
  edgeToEdgeDivider = false,
  hideDivider = false,
  communityName,
  communityImage,
}: ResourceCardProps) {
  const isDetail = variant === "detail";
  const typeInfo = RESOURCE_TYPES.find((type) => type.value === resource.resource_type);
  const isOwner = resource.user_id === currentUserId;
  const hasFigmaPrototype = getFigmaEmbedUrl(resource.url) !== null;
  const ogImage = useOgImage(resource.url, !hasFigmaPrototype && !isDetail);

  const [optimisticSave, setOptimisticSave] = useState<{ saved: boolean; count: number } | null>(null);
  const confirmedSaveRef = useRef(resource.user_saved);
  const desiredSaveRef = useRef(resource.user_saved);
  const optimisticSaveCountRef = useRef(resource.save_count);
  const saveRequestRunningRef = useRef(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const displayedSaved = optimisticSave?.saved ?? resource.user_saved;
  const displayedSaveCount = optimisticSave?.count ?? resource.save_count;

  const [optimisticBookmark, setOptimisticBookmark] = useState<{ bookmarked: boolean; count: number } | null>(null);
  const confirmedBookmarkRef = useRef(resource.user_bookmarked);
  const desiredBookmarkRef = useRef(resource.user_bookmarked);
  const optimisticBookmarkCountRef = useRef(resource.bookmark_count);
  const bookmarkRequestRunningRef = useRef(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const displayedBookmarked = optimisticBookmark?.bookmarked ?? resource.user_bookmarked;

  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reported, setReported] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Reusable mutation pattern: `pending` drives the disabled/spinner state and
  // concurrent invocations share the same in-flight request.
  const { run: runDelete, pending: deleting } = usePendingMutation(async () => {
    const response = await dedupeFetch(`/api/communities/${communityId}/resources/${resource.id}`, { method: "DELETE" });
    if (response.ok) onDeleted(resource.id);
  });

  async function handleDelete() {
    await runDelete();
  }

  async function flushSaveIntent() {
    if (saveRequestRunningRef.current) return;
    saveRequestRunningRef.current = true;
    setSaveBusy(true);
    try {
      while (confirmedSaveRef.current !== desiredSaveRef.current) {
        const response = await dedupeFetch(`/api/communities/${communityId}/resources/${resource.id}/save`, { method: "POST" }, { cooldownMode: "url" });
        if (!response.ok) throw new Error("Failed to update resource like");
        const result = (await response.json()) as { saved: boolean };
        confirmedSaveRef.current = result.saved;
      }
    } catch {
      desiredSaveRef.current = confirmedSaveRef.current;
      const rollbackCount = Math.max(0, optimisticSaveCountRef.current + (confirmedSaveRef.current ? 1 : -1));
      optimisticSaveCountRef.current = rollbackCount;
      setOptimisticSave({ saved: confirmedSaveRef.current, count: rollbackCount });
      onSaveChanged(resource.id, confirmedSaveRef.current, rollbackCount);
    } finally {
      saveRequestRunningRef.current = false;
      setSaveBusy(false);
      setOptimisticSave(null);
    }
  }

  function handleSave(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (saveBusy) return;
    const newSaved = !desiredSaveRef.current;
    const newCount = Math.max(0, optimisticSaveCountRef.current + (newSaved ? 1 : -1));
    desiredSaveRef.current = newSaved;
    optimisticSaveCountRef.current = newCount;
    setOptimisticSave({ saved: newSaved, count: newCount });
    onSaveChanged(resource.id, newSaved, newCount);
    void flushSaveIntent();
  }

  async function flushBookmarkIntent() {
    if (bookmarkRequestRunningRef.current) return;
    bookmarkRequestRunningRef.current = true;
    setBookmarkBusy(true);
    try {
      while (confirmedBookmarkRef.current !== desiredBookmarkRef.current) {
        const response = await dedupeFetch(`/api/communities/${communityId}/resources/${resource.id}/bookmark`, { method: "POST" }, { cooldownMode: "url" });
        if (!response.ok) throw new Error("Failed to update resource bookmark");
        const result = (await response.json()) as { bookmarked: boolean; bookmark_count: number };
        confirmedBookmarkRef.current = result.bookmarked;
        optimisticBookmarkCountRef.current = result.bookmark_count;
      }
    } catch {
      desiredBookmarkRef.current = confirmedBookmarkRef.current;
      const rollbackCount = Math.max(0, optimisticBookmarkCountRef.current + (confirmedBookmarkRef.current ? 1 : -1));
      optimisticBookmarkCountRef.current = rollbackCount;
      setOptimisticBookmark({ bookmarked: confirmedBookmarkRef.current, count: rollbackCount });
      onBookmarkChanged(resource.id, confirmedBookmarkRef.current, rollbackCount);
    } finally {
      bookmarkRequestRunningRef.current = false;
      setBookmarkBusy(false);
      setOptimisticBookmark(null);
    }
  }

  function handleBookmark(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (bookmarkBusy) return;
    const newBookmarked = !desiredBookmarkRef.current;
    const newCount = Math.max(0, optimisticBookmarkCountRef.current + (newBookmarked ? 1 : -1));
    desiredBookmarkRef.current = newBookmarked;
    optimisticBookmarkCountRef.current = newCount;
    setOptimisticBookmark({ bookmarked: newBookmarked, count: newCount });
    onBookmarkChanged(resource.id, newBookmarked, newCount);
    void flushBookmarkIntent();
  }

  const optionsMenu = (
    <div className="relative shrink-0" ref={menuRef} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <button
        type="button"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((open) => !open); }}
        aria-label="Resource options"
        className={`flex items-center justify-center text-foreground-subtle hover:bg-surface-raised hover:text-foreground ${isDetail ? "h-8 w-8 rounded-lg border border-border" : "h-7 w-7 rounded-md"}`}
      >
        <MoreHorizontal size={15} />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-border bg-surface py-1 shadow-lg">
          {!isDetail && (
            <button type="button" onClick={(event) => { handleBookmark(event); setMenuOpen(false); }} disabled={bookmarkBusy} aria-pressed={displayedBookmarked} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50">
              <Bookmark size={11} fill={displayedBookmarked ? "currentColor" : "none"} />
              {bookmarkBusy ? "Saving…" : displayedBookmarked ? "Unsave" : "Save"}
            </button>
          )}
          {isOwner ? (
            <>
              <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); setShowEditModal(true); }} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
                <Pencil size={11} /> Edit
              </button>
              <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); setConfirmDelete(true); }} disabled={deleting} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-red-400 hover:bg-surface-raised disabled:opacity-50">
                <Trash2 size={11} />{deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          ) : (
            <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); setReported(true); setTimeout(() => setReported(false), 3000); }} disabled={reported} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50">
              <Flag size={11} />{reported ? "Reported" : "Report"}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <article className={isDetail ? "" : `group cursor-pointer py-6 ${hideDivider ? "" : edgeToEdgeDivider ? communityFeedLayout.dividerBottom : "border-b border-border"}`}>
        <div className="flex items-start justify-between gap-3">
          <PostAuthorMeta
            name={resource.users?.name}
            avatarUrl={resource.users?.avatar_url}
            createdAt={resource.created_at}
            dateInline
            secondaryLabel={`Resources · ${typeInfo?.label ?? "Post"}`}
          />
          {isDetail ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saveBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-body text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${displayedSaved ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-foreground-muted hover:border-accent/40 hover:text-accent"}`}
              >
                {displayedSaved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
                {displayedSaved ? "Saved" : "Save"}
                <span className="font-mono text-[10px]">{displayedSaveCount}</span>
              </button>
              <a href={resource.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover">
                <ExternalLink size={13} />Open
              </a>
              {optionsMenu}
            </div>
          ) : optionsMenu}
        </div>

        {isDetail ? (
          <>
            <h1 className="mt-3 font-display text-lg font-semibold leading-snug text-foreground">{resource.title}</h1>
            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent">
              <ExternalLink size={11} />{getDomain(resource.url)}
            </a>
            {resource.description && <p className="mt-4 whitespace-pre-wrap font-body text-sm leading-relaxed text-foreground-muted">{resource.description}</p>}
            {hasFigmaPrototype && <FigmaEmbed url={resource.url} className="mt-4" />}
            {resource.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {resource.tags.map((tag) => <span key={tag} className="font-body text-[11px] text-foreground-subtle">#{tag}</span>)}
              </div>
            )}
          </>
        ) : (
          <>
            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="block">
              <h3 className="mt-3 line-clamp-3 whitespace-pre-wrap font-display text-sm font-semibold leading-snug text-foreground">{resource.description || resource.title}</h3>
            </a>
            {hasFigmaPrototype ? (
              <FigmaEmbed url={resource.url} compact className="mt-4" />
            ) : ogImage ? (
              <a href={resource.url} target="_blank" rel="noopener noreferrer" className="mt-4 block w-fit max-w-full overflow-hidden rounded-xl bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ogImage} alt="" className="block h-auto max-h-96 max-w-full object-contain" onError={(event) => { (event.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
              </a>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-4">
              <button type="button" onClick={handleSave} aria-label={displayedSaved ? "Unlike" : "Like"} aria-pressed={displayedSaved} disabled={saveBusy} className="group/like flex shrink-0 items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">
                <Heart size={20} strokeWidth={2} className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${displayedSaved ? "fill-red-500 text-red-500" : "fill-none text-white"}`} />
                <span className={`font-body text-sm font-semibold tabular-nums ${displayedSaved ? "text-red-500" : "text-white"}`}>{displayedSaveCount}</span>
              </button>
              {communityName && <CommunityPostLabel communityName={communityName} communityImage={communityImage} className="min-w-0 justify-end text-right" />}
            </div>
          </>
        )}
      </article>
      {showEditModal && (
        <EditResourceModal resource={resource} communityId={communityId} onClose={() => setShowEditModal(false)} onUpdated={(updated) => { onUpdated(updated); setShowEditModal(false); }} />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete resource?"
        message="This will permanently remove this resource. This cannot be undone."
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
