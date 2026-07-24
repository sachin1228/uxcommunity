"use client";

import { useEffect, useState } from "react";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";

// Module-level cache — persists across scroll/re-renders without refetching.
const previewCache = new Map<string, LinkPreviewData | null>();

function ImagePreview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="w-full object-cover max-h-40 block"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

interface LinkPreviewProps {
  url: string;
  isMe: boolean;
}

export function LinkPreview({ url, isMe }: LinkPreviewProps) {
  const [data, setData] = useState<LinkPreviewData | null | undefined>(
    // Hydrate from module-level cache instantly if available
    previewCache.has(url) ? previewCache.get(url) : undefined,
  );

  useEffect(() => {
    if (previewCache.has(url)) return;

    const controller = new AbortController();

    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<LinkPreviewData>) : null))
      .then((d) => {
        previewCache.set(url, d);
        setData(d);
      })
      .catch(() => {
        // AbortError on unmount — no-op. Any real error → show nothing.
        previewCache.set(url, null);
        setData(null);
      });

    return () => controller.abort();
  }, [url]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (data === undefined) {
    return (
      <div
        className={`mt-1.5 rounded-xl overflow-hidden border animate-pulse
          ${isMe
            ? "border-white/10 bg-black/20"
            : "border-white/5 bg-black/10"
          }`}
      >
        <div className="p-3 space-y-1.5">
          <div className="h-2.5 w-20 rounded bg-white/10" />
          <div className="h-3 w-36 rounded bg-white/10" />
          <div className="h-2 w-28 rounded bg-white/10" />
        </div>
      </div>
    );
  }

  // Nothing useful to show
  if (!data || (!data.title && !data.description && !data.image)) return null;

  const domain = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();

  const borderColor  = isMe ? "border-white/10"          : "border-white/[0.07]";
  const bgColor      = isMe ? "bg-black/20"               : "bg-black/10";
  const accentBar    = isMe ? "bg-white/20"               : "bg-accent/60";
  const siteColor    = isMe ? "text-accent-foreground/50" : "text-accent/80";
  const titleColor   = isMe ? "text-accent-foreground"    : "text-foreground";
  const descColor    = isMe ? "text-accent-foreground/70" : "text-foreground-muted";
  const domainColor  = isMe ? "text-accent-foreground/40" : "text-foreground-muted/60";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`mt-1.5 block rounded-xl overflow-hidden border transition-opacity
        duration-150 hover:opacity-90 active:opacity-75
        ${borderColor} ${bgColor}`}
    >
      {/* OG image */}
      {data.image && <ImagePreview src={data.image} />}

      {/* Text content with left accent bar */}
      <div className="flex gap-2.5 px-3 py-2.5">
        {/* Accent bar — mirrors WhatsApp's left-edge highlight */}
        <div className={`w-0.5 self-stretch rounded-full shrink-0 ${accentBar}`} />

        <div className="min-w-0 flex-1">
          {data.siteName && (
            <p className={`font-body text-[10px] font-semibold uppercase tracking-wide truncate ${siteColor}`}>
              {data.siteName}
            </p>
          )}
          {data.title && (
            <p className={`font-body text-[12px] font-semibold leading-snug line-clamp-2 mt-0.5 ${titleColor}`}>
              {data.title}
            </p>
          )}
          {data.description && (
            <p className={`font-body text-[11px] leading-snug line-clamp-2 mt-0.5 ${descColor}`}>
              {data.description}
            </p>
          )}
          <p className={`font-body text-[10px] truncate mt-1 ${domainColor}`}>
            {domain}
          </p>
        </div>
      </div>
    </a>
  );
}
