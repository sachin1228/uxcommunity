"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CarouselImage {
  url: string;
  name: string;
  /** Optional MIME type — when it starts with video/, the slide renders a <video>. */
  type?: string;
}

/**
 * Inline media carousel for cards with 2+ attachments.
 *
 * All items sit side by side in a horizontal track and the viewport slides
 * between them (translateX on the track), so Next moves the current item out
 * to the left while the next one enters from the right — and Previous does the
 * reverse. An invisible copy of the first item anchors the viewport height in
 * normal flow, so the surrounding card layout never jumps. Swipe gestures
 * work on touch devices without interfering with vertical scrolling.
 *
 * Image slides render <img>; video slides (items whose `type` starts with
 * "video/") render an inline <video controls> instead. Clicking the visible
 * image reports its index via `onImageClick` so the parent can open the
 * full-screen lightbox — media never opens in a new tab.
 */
export function ThreadImageCarousel({
  images,
  onImageClick,
}: {
  images: CarouselImage[];
  onImageClick: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  if (images.length < 2) return null;

  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const goPrev = () => setIndex((current) => Math.max(0, current - 1));
  const goNext = () => setIndex((current) => Math.min(images.length - 1, current + 1));

  // The sizing anchor borrows the intrinsic dimensions of a real image; when
  // the set is all videos there is no <img> to borrow from, so a 16:9 spacer
  // stands in (videos letterbox inside it).
  const anchorImage = images.find((img) => !(typeof img.type === "string" && img.type.startsWith("video/"))) ?? null;

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

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label="Thread media"
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: "pan-y" }}
      className="group relative mt-3 select-none overflow-hidden rounded-xl border border-border bg-surface"
    >
      {/* Invisible sizing anchor — keeps the viewport height identical to the
          single-image layout so the card never jumps while sliding. Must be a
          real image (videos have no reliable intrinsic height before load); a
          16:9 spacer takes over when the set is all videos. */}
      {anchorImage ? (
        <img
          src={anchorImage.url}
          alt=""
          draggable={false}
          aria-hidden
          className="pointer-events-none block w-full max-h-[480px] object-contain opacity-0"
        />
      ) : (
        <div aria-hidden className="aspect-video w-full" />
      )}

      {/* Slide track — images sit physically next to each other and the
          viewport translates between them (300ms ease-out, no bounce). */}
      <div
        className="absolute inset-0 flex h-full w-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {images.map((img, slideIndex) => {
          const active = slideIndex === index;
          const isVideo = typeof img.type === "string" && img.type.startsWith("video/");
          // Native aspect ratio, capped at 480px tall — never cropped.
          const inner = isVideo ? (
            <video
              src={img.url}
              aria-label={img.name}
              controls
              preload="metadata"
              className="mx-auto h-full max-h-[480px] w-auto max-w-full object-contain"
            />
          ) : (
            <img
              src={img.url}
              alt={img.name}
              draggable={false}
              className="mx-auto h-full w-auto max-w-full object-contain"
            />
          );
          return (
            <div
              key={img.url}
              role={isVideo ? undefined : "button"}
              tabIndex={!isVideo && active ? 0 : -1}
              aria-hidden={!active}
              aria-label={active && !isVideo ? `Open media ${slideIndex + 1} of ${images.length}` : undefined}
              className={`h-full w-full shrink-0 overflow-hidden ${
                active ? (isVideo ? "block" : "block cursor-pointer") : "pointer-events-none block"
              }`}
              onClick={(event) => {
                // Videos play inline — only image slides open the lightbox, and
                // the click must not bubble to a parent card navigation.
                if (isVideo) {
                  event.stopPropagation();
                  return;
                }
                // A swipe ends in a click on touch devices — don't open after one.
                if (suppressClickRef.current) {
                  event.preventDefault();
                  suppressClickRef.current = false;
                  return;
                }
                event.stopPropagation();
                onImageClick(slideIndex);
              }}
              onKeyDown={(event) => {
                if (isVideo) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onImageClick(slideIndex);
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
        className={`absolute left-2.5 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${
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
        className={`absolute right-2.5 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${
          hasNext ? "" : "hidden"
        }`}
      >
        <ChevronRight size={18} strokeWidth={2.5} />
      </button>

      {/* Pagination indicators (carousel dots) — one per image, clickable */}
      <div
        role="group"
        aria-label="Image navigation"
        className="absolute bottom-2.5 left-1/2 z-20 flex -translate-x-1/2 items-center rounded-full bg-black/50 px-1.5 py-1"
      >
        {images.map((img, dotIndex) => {
          const active = dotIndex === index;
          return (
            <button
              key={img.url}
              type="button"
              aria-label={`Go to image ${dotIndex + 1} of ${images.length}`}
              aria-current={active ? "true" : undefined}
              onClick={() => setIndex(dotIndex)}
              className="flex h-3 w-2.5 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <span
                className={`block h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
                  active ? "bg-white" : "bg-white/40"
                }`}
              />
            </button>
          );
        })}
      </div>

      <span className="sr-only" role="status">
        {`Image ${index + 1} of ${images.length}`}
      </span>
    </div>
  );
}