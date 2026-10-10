"use client";

import { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Play, X } from "lucide-react";
import { ChatAvatar } from "../chat/ChatAvatar";
import { fmtDate, fmtTime } from "../chat/chatUtils";
import {
  isVideoItem,
  isVideoReady,
  mediaItemKey,
  mediaSourceActionLabel,
  MEDIA_SOURCE_LABELS,
  type CommunityMediaItem,
} from "./types";

interface MediaLightboxProps {
  items: CommunityMediaItem[];
  /** Index of the currently viewed item inside `items`. */
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onOpenSource: (item: CommunityMediaItem) => void;
}

/** Derive a sane filename (and keep the extension) from a CDN/object URL. */
function fileNameForUrl(url: string): string {
  try {
    const name = (new URL(url).pathname.split("/").pop() ?? "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return name || "media";
  } catch {
    return "media";
  }
}

/**
 * Download through our same-origin proxy (the R2 bucket sends no CORS
 * headers, so a direct fetch is blocked and an anchor would navigate).
 */
function downloadImage(url: string, fallbackName: string) {
  const a = document.createElement("a");
  a.href = `/api/image-download?url=${encodeURIComponent(url)}`;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Full-screen viewer for the community Media tab: the current image/video is
 * centered with arrow navigation and a thumbnail strip, and the header names
 * both the uploader and the content the media came from.
 */
export function MediaLightbox({
  items,
  index,
  onClose,
  onNavigate,
  onOpenSource,
}: MediaLightboxProps) {
  const item = items[index];
  const stripRef = useRef<HTMLDivElement>(null);

  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);

  const goNext = useCallback(() => {
    if (index < items.length - 1) onNavigate(index + 1);
  }, [index, items.length, onNavigate]);

  // Keyboard navigation (Esc / arrows) + scroll lock while the viewer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goPrev, goNext]);

  // Keep the active thumbnail in view when navigating.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [index]);

  if (!item) return null;

  const video = isVideoItem(item);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[#1e1e1e]"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      {/* ── Header: uploader + source + actions ─────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <ChatAvatar
            name={item.author?.name ?? "Unknown"}
            url={item.author?.avatar_url ?? null}
            size={9}
          />
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-semibold text-foreground">
              {item.author?.name ?? "Unknown"}
            </p>
            <p className="font-body text-[11px] text-foreground-muted">
              {fmtDate(item.created_at)} at {fmtTime(item.created_at)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onOpenSource(item)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 font-body text-xs text-foreground transition-colors hover:bg-white/10"
            title={`${MEDIA_SOURCE_LABELS[item.source]} · ${item.source_title}`}
          >
            <ExternalLink strokeWidth={2.5} size={13} aria-hidden="true" />
            {mediaSourceActionLabel(item)}
          </button>
          {!video && (
            <button
              type="button"
              onClick={() => downloadImage(item.url, fileNameForUrl(item.url))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/10"
              aria-label="Download image"
              title="Download"
            >
              <Download strokeWidth={2.5} size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white/10"
            aria-label="Close viewer"
            title="Close"
          >
            <X strokeWidth={2.5} size={18} />
          </button>
        </div>
      </div>

      {/* ── Canvas: centered media + side navigation ────────────────────── */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16">
        {index > 0 && (
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            aria-label="Previous media"
          >
            <ChevronLeft strokeWidth={2.5} size={22} />
          </button>
        )}
        {video ? (
          isVideoReady(item) ? (
            <video
              src={item.url}
              poster={item.poster ?? undefined}
              controls
              autoPlay
              className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-sm bg-black/60 px-10 py-16 text-white">
              <Play strokeWidth={2} size={28} className="text-white/50" />
              <span className="font-body text-sm text-white/70">
                {item.status === "failed" ? "Video unavailable" : "Processing video…"}
              </span>
            </div>
          )
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={item.url}
            alt={item.source_title}
            className="max-h-full max-w-full select-none rounded-sm object-contain shadow-2xl"
            draggable={false}
          />
        )}
        {index < items.length - 1 && (
          <button
            type="button"
            onClick={goNext}
            className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            aria-label="Next media"
          >
            <ChevronRight strokeWidth={2.5} size={22} />
          </button>
        )}
      </div>

      {/* ── Source line: where this media lives ─────────────────────────── */}
      <div className="shrink-0 px-6 pb-2 text-center">
        <p className="font-body text-xs text-foreground/80">
          {MEDIA_SOURCE_LABELS[item.source]} · {item.source_title}
        </p>
      </div>

      {/* ── Thumbnail strip — jump between every item ───────────────────── */}
      {items.length > 1 && (
        <div ref={stripRef} className="shrink-0 overflow-x-auto scrollbar-none py-3">
          <div className="mx-auto flex w-max items-center gap-2 px-4">
            {items.map((thumb, i) => {
              const thumbUrl = isVideoItem(thumb) ? thumb.poster : thumb.url;
              return (
                <button
                  type="button"
                  key={mediaItemKey(thumb)}
                  onClick={() => onNavigate(i)}
                  data-active={i === index}
                  aria-label={`View media ${i + 1} of ${items.length}`}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border transition-all ${
                    i === index
                      ? "border-[var(--ds-blue-800)] ring-2 ring-[var(--ds-blue-800)]"
                      : "border-white/15 opacity-70 hover:opacity-100"
                  }`}
                >
                  {thumbUrl ? (
                    <span className="relative block h-full w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl}
                        alt=""
                        className="pointer-events-none h-full w-full object-cover"
                        draggable={false}
                      />
                      {isVideoItem(thumb) && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                          <Play strokeWidth={2.5} size={16} fill="currentColor" />
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-neutral-900 text-white">
                      <Play strokeWidth={2.5} size={16} fill="currentColor" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
