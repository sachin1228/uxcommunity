"use client";

import { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtDate, fmtTime } from "./chatUtils";

/** One image from the chat timeline, as shown inside the viewer. */
export interface LightboxImage {
  url: string;
  content: string | null;
  user_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  /** Index of the currently viewed image inside `images`. */
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

/** Derive a sane filename (and keep the extension) from a CDN/object URL. */
function fileNameForUrl(url: string): string {
  try {
    const name = (new URL(url).pathname.split("/").pop() ?? "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return name || "chat-image";
  } catch {
    return "chat-image";
  }
}

/**
 * Download the image via fetch → blob so it lands in the user's Downloads
 * folder with a proper filename. If the image host blocks CORS, fall back to
 * opening the URL in a new tab.
 */
async function downloadImage(url: string, fallbackName: string) {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function ImageLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: ImageLightboxProps) {
  const image = images[index];
  const stripRef = useRef<HTMLDivElement>(null);

  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);

  const goNext = useCallback(() => {
    if (index < images.length - 1) onNavigate(index + 1);
  }, [index, images.length, onNavigate]);

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

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[#1e1e1e]"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      {/* ── Header: sender info + actions ───────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <ChatAvatar
            name={image.user_name ?? "Unknown"}
            url={image.avatar_url}
            size={9}
          />
          <div className="min-w-0">
            <p className="font-body text-sm font-semibold text-foreground truncate">
              {image.user_name ?? "Unknown"}
            </p>
            <p className="font-body text-[11px] text-foreground-muted">
              {fmtDate(image.created_at)} at {fmtTime(image.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => downloadImage(image.url, fileNameForUrl(image.url))}
            className="h-9 w-9 flex items-center justify-center rounded-full text-foreground hover:bg-white/10 transition-colors"
            aria-label="Download image"
            title="Download"
          >
            <Download size={18} />
          </button>
          <button
            onClick={onClose}
            className="h-9 w-9 flex items-center justify-center rounded-full text-foreground hover:bg-white/10 transition-colors"
            aria-label="Close viewer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Canvas: centered image + side navigation ────────────────────── */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-16">
        {index > 0 && (
          <button
            onClick={goPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            aria-label="Previous image"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt=""
          className="max-h-full max-w-full object-contain select-none rounded-sm shadow-2xl"
          draggable={false}
        />
        {index < images.length - 1 && (
          <button
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            aria-label="Next image"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      {/* ── Caption (message text that accompanied the image) ───────────── */}
      {image.content && (
        <div className="shrink-0 px-6 pb-2 text-center">
          <p className="font-body text-xs text-foreground/80 whitespace-pre-wrap break-words">
            {image.content}
          </p>
        </div>
      )}

      {/* ── Thumbnail strip — jump between every image in the chat ──────── */}
      {images.length > 1 && (
        <div
          ref={stripRef}
          className="shrink-0 overflow-x-auto scrollbar-none py-3"
        >
          <div className="flex items-center gap-2 w-max mx-auto px-4">
            {images.map((img, i) => (
              <button
                key={`${img.url}-${i}`}
                onClick={() => onNavigate(i)}
                data-active={i === index}
                aria-label={`View image ${i + 1} of ${images.length}`}
                className={`shrink-0 h-14 w-14 overflow-hidden rounded-md border transition-all ${
                  i === index
                    ? "border-[var(--ds-blue-700)] ring-2 ring-[var(--ds-blue-700)]"
                    : "border-white/15 opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt=""
                  className="h-full w-full object-cover pointer-events-none"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}