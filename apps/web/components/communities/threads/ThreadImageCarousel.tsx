"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CarouselImage {
  url: string;
  name: string;
}

/**
 * Inline image carousel for thread cards with 2+ images.
 *
 * The first image anchors the viewport in normal flow (so the container's
 * height — and the surrounding thread layout — never changes when switching
 * slides); every other image is layered on top with object-cover. Slides
 * crossfade with a short opacity transition. Arrows navigate with mouse or
 * keyboard, and horizontal swipes work on touch devices without interfering
 * with vertical scrolling.
 */
export function ThreadImageCarousel({
  images,
  isDetail,
}: {
  images: CarouselImage[];
  isDetail: boolean;
}) {
  const [index, setIndex] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  if (images.length < 2) return null;

  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const goPrev = () => setIndex((current) => Math.max(0, current - 1));
  const goNext = () => setIndex((current) => Math.min(images.length - 1, current + 1));

  function openImage(url: string) {
    // A swipe ends in a click on touch devices — don't open the tab after one.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    suppressClickRef.current = false;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Horizontal swipe past a small threshold; vertical gestures keep scrolling.
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      suppressClickRef.current = true;
      if (dx < 0) goNext();
      else goPrev();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrev();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  }

  const slideClassName = (active: boolean) =>
    `transition-opacity duration-200 ease-out ${
      active ? "opacity-100" : "pointer-events-none opacity-0"
    }`;

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label="Thread images"
      onKeyDown={handleKeyDown}
      className="relative mt-3 select-none overflow-hidden rounded-xl border border-border bg-surface"
    >
      {/* Stable viewport — the first image defines the height */}
      <div
        className="relative w-full"
        style={{ touchAction: "pan-y" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {images.map((img, slideIndex) => {
          const active = index === slideIndex;
          const isAnchor = slideIndex === 0;
          const inner = (
            <img
              src={img.url}
              alt={img.name}
              draggable={false}
              className={`object-cover ${
                isAnchor ? "block w-full max-h-[480px]" : "absolute inset-0 h-full w-full"
              } ${slideClassName(active)}`}
            />
          );
          const clickGuard = (event: React.MouseEvent) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              suppressClickRef.current = false;
              return;
            }
            event.stopPropagation();
          };
          return isDetail ? (
            <a
              key={img.url}
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-hidden={!active}
              tabIndex={active ? undefined : -1}
              className={active ? "block" : "pointer-events-none block"}
              onClick={clickGuard}
            >
              {inner}
            </a>
          ) : (
            <div
              key={img.url}
              role="link"
              tabIndex={active ? 0 : -1}
              aria-hidden={!active}
              className={active ? "block cursor-pointer" : "pointer-events-none block"}
              onClick={(event) => {
                clickGuard(event);
                if (!event.defaultPrevented) openImage(img.url);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  openImage(img.url);
                }
              }}
            >
              {inner}
            </div>
          );
        })}
      </div>

      {/* Previous */}
      <button
        type="button"
        aria-label="Previous image"
        onClick={goPrev}
        className={`absolute left-2.5 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
          hasPrev ? "" : "hidden"
        }`}
      >
        <ChevronLeft size={18} strokeWidth={2.5} />
      </button>

      {/* Next */}
      <button
        type="button"
        aria-label="Next image"
        onClick={goNext}
        className={`absolute right-2.5 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
          hasNext ? "" : "hidden"
        }`}
      >
        <ChevronRight size={18} strokeWidth={2.5} />
      </button>

      {/* Pagination dots */}
      <div
        aria-hidden
        className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1"
      >
        {images.map((img, dotIndex) => (
          <span
            key={img.url}
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
              dotIndex === index ? "bg-white" : "bg-white/40"
            }`}
          />
        ))}
      </div>

      <span className="sr-only" role="status">
        {`Image ${index + 1} of ${images.length}`}
      </span>
    </div>
  );
}