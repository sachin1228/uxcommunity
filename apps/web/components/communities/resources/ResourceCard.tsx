"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bookmark, BookmarkCheck, ExternalLink, Flag, Heart,
  MoreHorizontal, Pencil, Trash2,
} from "lucide-react";
import type { CommunityResource } from "./types";
import { RESOURCE_TYPES } from "./types";
import { ResourceFormModal } from "./ResourceFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { communityFeedLayout } from "../feed-layout";
import { CommunityPostLabel } from "../CommunityPostLabel";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { FigmaEmbed } from "./FigmaEmbed";
import { getFigmaEmbedUrl } from "@/lib/communities/figma";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";
import {
  fetchLinkPreview,
  getCachedLinkPreview,
  hasFreshLinkPreview,
} from "@/lib/communities/linkPreviewCache";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import { usePendingMutation } from "@/lib/use-mutation";

function useLinkPreview(url: string, enabled: boolean) {
  const [data, setData] = useState<LinkPreviewData | null | undefined>(
    enabled ? (getCachedLinkPreview(url) ?? undefined) : null,
  );

  useEffect(() => {
    if (!enabled) return;
    if (hasFreshLinkPreview(url)) {
      setData(getCachedLinkPreview(url) ?? null);
      return;
    }
    let cancelled = false;
    void fetchLinkPreview(url).then((result) => {
      if (!cancelled) setData(result.data);
    });
    return () => { cancelled = true; };
  }, [enabled, url]);

  return data;
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
  const linkPreview = useLinkPreview(resource.url, !hasFigmaPrototype && !isDetail);

  const latestSaveRef = useRef({ resource, onSaveChanged });
  const initialSavedRef = useRef(resource.user_saved);
  const saveCoalescerRef = useRef<BooleanIntentCoalescer | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    latestSaveRef.current = { resource, onSaveChanged };
  });

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

  useEffect(() => {
    const resourceId = resource.id;
    const coordinator = new BooleanIntentCoalescer({
      initialValue: initialSavedRef.current,
      onOptimisticChange: (saved) => {
        const current = latestSaveRef.current;
        const count = Math.max(
          0,
          current.resource.save_count + (saved === current.resource.user_saved ? 0 : saved ? 1 : -1),
        );
        current.onSaveChanged(current.resource.id, saved, count);
      },
      persist: async (saved) => {
        const response = await dedupeFetch(
          `/api/communities/${communityId}/resources/${resourceId}/save`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ saved }),
          },
          { cooldownMode: "url" },
        );
        const result = (await response.json().catch(() => null)) as {
          saved?: boolean;
          save_count?: number;
          error?: string;
        } | null;
        if (!response.ok || typeof result?.saved !== "boolean") {
          throw new Error(result?.error ?? "Failed to update resource like.");
        }
        const current = latestSaveRef.current;
        current.onSaveChanged(resourceId, result.saved, result.save_count ?? current.resource.save_count);
        return result.saved;
      },
      onPendingChange: setSaveBusy,
    });

    saveCoalescerRef.current = coordinator;
    return () => {
      coordinator.dispose();
      saveCoalescerRef.current = null;
    };
  }, [communityId, resource.id]);

  useEffect(() => {
    saveCoalescerRef.current?.syncConfirmed(resource.user_saved);
  }, [resource.user_saved]);

  function handleSave(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    saveCoalescerRef.current?.toggle();
  }

  async function flushBookmarkIntent() {
    if (bookmarkRequestRunningRef.current) return;
    bookmarkRequestRunningRef.current = true;
    setBookmarkBusy(true);
    try {
      while (confirmedBookmarkRef.current !== desiredBookmarkRef.current) {
        const response = await dedupeFetch(`/api/communities/${communityId}/resources/${resource.id}/bookmark`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookmarked: desiredBookmarkRef.current }),
        }, { cooldownMode: "url" });
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
            <button type="button" onClick={(event) => { handleBookmark(event); setMenuOpen(false); }} aria-busy={bookmarkBusy} aria-pressed={displayedBookmarked} className="flex w-full items-center gap-2 px-3 py-1.5 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground">
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
      <article className={isDetail ? communityFeedLayout.detailCard : `group cursor-pointer ${hideDivider ? "py-0" : edgeToEdgeDivider ? communityFeedLayout.dividerBottom : `${communityFeedLayout.card} ${communityFeedLayout.cardInteractive}`}`}>
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
                aria-busy={saveBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-body text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${resource.user_saved ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-foreground-muted hover:border-accent/40 hover:text-accent"}`}
              >
                {resource.user_saved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
                {resource.user_saved ? "Saved" : "Save"}
                <span className="font-mono text-[10px]">{resource.save_count}</span>
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
            ) : linkPreview && (linkPreview.title || linkPreview.description || linkPreview.image) ? (
              <a
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-start gap-4 overflow-hidden rounded-xl border border-border bg-surface-raised p-4 transition-opacity duration-150 hover:opacity-90 active:opacity-75"
              >
                <div className="min-w-0 flex-1">
                  {linkPreview.title && (
                    <p className="line-clamp-2 font-display text-[12px] font-semibold leading-snug text-foreground">
                      {linkPreview.title}
                    </p>
                  )}
                  {linkPreview.description && (
                    <p className="mt-1 line-clamp-3 font-body text-[10px] leading-relaxed text-foreground-muted">
                      {linkPreview.description}
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${getDomain(resource.url)}&sz=32`}
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5 rounded-sm"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                    <span className="truncate font-body text-[11px] text-foreground-subtle">
                      {getDomain(resource.url)}
                    </span>
                  </div>
                </div>
                {linkPreview.image && (
                  <div className="h-24 w-36 shrink-0 overflow-hidden rounded-lg bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={linkPreview.image}
                      alt=""
                      className="block h-full w-full object-cover"
                      onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                    />
                  </div>
                )}
              </a>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-4">
              <button type="button" onClick={handleSave} aria-label={resource.user_saved ? "Unlike" : "Like"} aria-pressed={resource.user_saved} aria-busy={saveBusy} className="group/like flex shrink-0 items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">
                <Heart size={20} strokeWidth={2} className={`transition-transform duration-150 ease-out group-hover/like:scale-110 ${resource.user_saved ? "fill-red-500 text-red-500" : "fill-none text-white"}`} />
                <span className={`font-body text-sm font-semibold tabular-nums ${resource.user_saved ? "text-red-500" : "text-white"}`}>{resource.save_count}</span>
              </button>
              {communityName && <CommunityPostLabel communityName={communityName} communityImage={communityImage} className="min-w-0 justify-end text-right" />}
            </div>
          </>
        )}
      </article>
      {showEditModal && (
        <ResourceFormModal mode="edit" resource={resource} communityId={communityId} onClose={() => setShowEditModal(false)} onSaved={(updated) => { onUpdated(updated); setShowEditModal(false); }} />
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
