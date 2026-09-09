"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/Modal";
import type { ShowcaseAttachment } from "./types";

/**
 * Full-screen viewer for showcase media. Clicking an image on a showcase card
 * opens this modal: the current item is centered with arrow navigation and a
 * thumbnail strip. Videos render with native controls (open via the strip).
 */
export function ShowcaseMediaLightbox({
  media,
  initialIndex,
  onClose,
}: {
  media: ShowcaseAttachment[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(0, media.length - 1)),
  );

  const goPrev = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);
  const goNext = useCallback(() => setIndex((current) => Math.min(media.length - 1, current + 1)), [media.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") goPrev();
      else if (event.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goPrev, goNext]);

  if (media.length === 0) return null;

  const item = media[index];
  const isVideo = item.type.startsWith("video/");

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Showcase media viewer"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="relative flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-black shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            title="Close (Esc)"
            className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          >
            <X strokeWidth={2.5} size={18} />
          </button>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-16 py-4">
            {index > 0 && (
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous media"
                className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft strokeWidth={2.5} size={22} />
              </button>
            )}
            {isVideo ? (
              <video
                src={item.url}
                controls
                autoPlay
                className="max-h-full max-w-full rounded-sm object-contain shadow-2xl"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={item.url}
                alt={item.name}
                draggable={false}
                className="max-h-full max-w-full select-none rounded-sm object-contain shadow-2xl"
              />
            )}
            {index < media.length - 1 && (
              <button
                type="button"
                onClick={goNext}
                aria-label="Next media"
                className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight strokeWidth={2.5} size={22} />
              </button>
            )}
          </div>

          {media.length > 1 && (
            <div className="shrink-0 border-t border-white/10 px-4 py-3">
              <div className="flex overflow-x-auto px-1 py-1">
                <div className="mx-auto flex w-max items-center gap-2">
                  {media.map((item, i) => (
                    <button
                      key={`${item.url}-${i}`}
                      type="button"
                      onClick={() => setIndex(i)}
                      data-active={i === index}
                      aria-label={`View media ${i + 1} of ${media.length}`}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border transition-all ${
                        i === index
                          ? "border-[var(--ds-blue-800)] ring-2 ring-[var(--ds-blue-800)]"
                          : "border-white/15 opacity-70 hover:opacity-100"
                      }`}
                    >
                      {item.type.startsWith("video/") ? (
                        <span className="flex h-full w-full items-center justify-center bg-neutral-900 text-white">
                          <Play strokeWidth={2.5} size={16} fill="currentColor" />
                        </span>
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.url} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}