"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";
import {
  fetchLinkPreview,
  getCachedLinkPreview,
  hasFreshLinkPreview,
} from "@/lib/communities/linkPreviewCache";

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
    // Hydrate from the shared cache instantly if available
    getCachedLinkPreview(url),
  );
  useEffect(() => {
    if (hasFreshLinkPreview(url)) return;

    let cancelled = false;
    // The shared cache dedups: concurrent callers receive the same promise
    // and only one network request is ever started per URL.
    void fetchLinkPreview(url).then((result) => {
      if (!cancelled) {
        setData(result.data);
      }
    });

    return () => { cancelled = true; };
  }, [url]);

  // ── Loading spinner ─────────────────────────────────────────────────────────
  if (data === undefined) {
    return (
      <div
        className={`mt-1.5 flex min-h-12 items-center justify-center rounded-xl overflow-hidden border
          ${isMe
            ? "border-white/10 bg-black/20"
            : "border-white/5 bg-black/10"
          }`}
      >
        <Spinner size={16} className="text-foreground-muted" />
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
