"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { type ThreadAttachment } from "@/lib/communities/models/threads";
import { ModalPortal } from "@/components/ui/Modal";

// ── Main component ────────────────────────────────────────────────────────────

interface ThreadImageLightboxProps {
  /** Image attachments only (already filtered by the caller). */
  images: ThreadAttachment[];
  /** Image to show first. */
  initialIndex: number;
  onClose: () => void;
}

/**
 * Full-screen viewer for thread images. Clicking an image on a thread card
 * opens this modal instead of a new tab: the image fills the viewer with
 * carousel navigation (arrows / thumbnails / keyboard).
 *
 * Deliberately image-only: the thread's text, author, likes and comments stay
 * on the card and the thread detail page — the sidebar that used to duplicate
 * them here made the picture a bystander in its own viewer.
 */
export function ThreadImageLightbox({
  images,
  initialIndex,
  onClose,
}: ThreadImageLightboxProps) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(0, images.length - 1)),
  );
  const stripRef = useRef<HTMLDivElement>(null);

  const goPrev = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((current) => Math.min(images.length - 1, current + 1));
  }, [images.length]);

  // Keyboard navigation (Esc / arrows) + scroll lock while the viewer is open.
  // Arrow keys are ignored while typing anywhere editable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
      if (e.key === "ArrowLeft") goPrev();
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
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [index]);

  if (images.length === 0) return null;

  const image = images[index];

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Thread image viewer"
        className="relative flex h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-[#151515] shadow-2xl"
      >
        {/* Close — top-right corner of the modal */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewer"
          title="Close (Esc)"
          className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        >
          <X strokeWidth={2.5} size={18} />
        </button>

        {/* ── Image canvas + carousel ───────────────────────────────────── */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-16 py-4">
            {index > 0 && (
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft strokeWidth={2.5} size={22} />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.name}
              draggable={false}
              className="max-h-full max-w-full select-none rounded-sm object-contain shadow-2xl"
            />
            {index < images.length - 1 && (
              <button
                type="button"
                onClick={goNext}
                aria-label="Next image"
                className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight strokeWidth={2.5} size={22} />
              </button>
            )}
          </div>

          {images.length > 1 && (
            <div className="shrink-0 border-t border-white/10 px-4 py-3">
              <div ref={stripRef} className="flex overflow-x-auto scrollbar-none px-1 py-1">
                <div className="mx-auto flex w-max items-center gap-2">
                  {images.map((img, i) => (
                    <button
                      key={`${img.url}-${i}`}
                      type="button"
                      onClick={() => setIndex(i)}
                      data-active={i === index}
                      aria-label={`View image ${i + 1} of ${images.length}`}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border transition-all ${
                        i === index
                          ? "border-[var(--ds-blue-800)] ring-2 ring-[var(--ds-blue-800)]"
                          : "border-white/15 opacity-70 hover:opacity-100"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
