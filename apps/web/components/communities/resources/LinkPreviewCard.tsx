"use client";

import { Globe, X } from "lucide-react";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";

interface LinkPreviewCardProps {
  data: LinkPreviewData;
  onDismiss?: () => void;
}

function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function LinkPreviewCard({ data, onDismiss }: LinkPreviewCardProps) {
  const domain = getDomain(data.url);

  return (
    <div className="relative flex items-start gap-4 overflow-hidden rounded-xl border border-border bg-surface-raised p-4">
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-1 text-white/80 backdrop-blur-sm hover:text-white"
          aria-label="Remove preview"
        >
          <X size={12} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        {data.title && (
          <p className="line-clamp-2 font-display text-[12px] font-semibold leading-snug text-foreground">
            {data.title}
          </p>
        )}
        {data.description && (
          <p className="mt-1 line-clamp-3 font-body text-[10px] leading-relaxed text-foreground-muted">
            {data.description}
          </p>
        )}
        <div className="mt-2.5 flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
            alt=""
            width={14}
            height={14}
            className="h-3.5 w-3.5 rounded-sm"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty("display", "block");
            }}
          />
          <Globe size={14} className="hidden text-foreground-subtle" />
          <span className="truncate font-body text-[11px] text-foreground-subtle">
            {domain}
          </span>
        </div>
      </div>

      {data.image && (
        <div className="h-24 w-36 shrink-0 overflow-hidden rounded-lg bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.image}
            alt=""
            className="block h-full w-full object-cover"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
          />
        </div>
      )}
    </div>
  );
}
