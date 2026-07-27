"use client";

import { ExternalLink, Globe, X } from "lucide-react";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";

interface LinkPreviewCardProps {
  data: LinkPreviewData;
  onDismiss?: () => void;
}

export function LinkPreviewCard({ data, onDismiss }: LinkPreviewCardProps) {
  const domain = (() => {
    try { return new URL(data.url).hostname.replace(/^www\./, ""); }
    catch { return data.siteName ?? ""; }
  })();

  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-raised">
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

      {data.image && (
        <div className="relative h-40 w-full overflow-hidden bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.image}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
          />
        </div>
      )}

      <div className="flex items-start gap-3 p-3">
        {/* Favicon */}
        <div className="mt-0.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={faviconUrl}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4 rounded-sm"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty("display", "block");
            }}
          />
          <Globe size={14} className="hidden text-foreground-subtle" />
        </div>

        <div className="min-w-0 flex-1">
          {/* Site name */}
          {domain && (
            <p className="mb-0.5 truncate font-body text-[10px] uppercase tracking-wide text-foreground-subtle">
              {data.siteName ?? domain}
            </p>
          )}
          {/* Title */}
          {data.title && (
            <p className="line-clamp-2 font-body text-sm font-medium leading-snug text-foreground">
              {data.title}
            </p>
          )}
          {/* Description */}
          {data.description && (
            <p className="mt-1 line-clamp-2 font-body text-xs leading-relaxed text-foreground-muted">
              {data.description}
            </p>
          )}
          {/* URL */}
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 truncate font-body text-[11px] text-foreground-subtle hover:text-accent"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={10} />
            <span className="truncate">{domain}</span>
          </a>
        </div>
      </div>
    </div>
  );
}
