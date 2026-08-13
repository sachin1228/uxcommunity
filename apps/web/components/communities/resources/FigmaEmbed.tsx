"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Maximize2 } from "lucide-react";
import { getFigmaEmbedUrl } from "@/lib/communities/figma";

interface FigmaEmbedProps {
  url: string;
  className?: string;
  compact?: boolean;
}

export function FigmaEmbed({ url, className = "", compact = false }: FigmaEmbedProps) {
  const embedUrl = useMemo(() => getFigmaEmbedUrl(url), [url]);
  const [loaded, setLoaded] = useState(false);
  const embedRef = useRef<HTMLDivElement>(null);

  if (!embedUrl) return null;

  async function viewFullscreen() {
    await embedRef.current?.requestFullscreen();
  }

  return (
    <div
      ref={embedRef}
      className={`overflow-hidden rounded-xl border border-border bg-surface-raised ${className}`}
    >
      <div className={`relative w-full ${compact ? "aspect-[4/3] sm:aspect-video" : "aspect-[4/3] md:aspect-video"}`}>
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-foreground-muted">
            <Loader2 size={16} className="animate-spin" />
            <span className="font-body text-sm">Loading Figma prototype…</span>
          </div>
        )}
        <iframe
          src={embedUrl}
          title="Interactive Figma prototype"
          loading="lazy"
          allowFullScreen
          allow="fullscreen; clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <span className="font-body text-xs text-foreground-muted">Interactive prototype</span>
        <button
          type="button"
          onClick={viewFullscreen}
          className="inline-flex min-h-8 items-center gap-1.5 font-body text-xs font-medium text-accent hover:text-accent-hover"
          aria-label="View prototype in full screen"
        >
          View full screen <Maximize2 size={12} />
        </button>
      </div>
    </div>
  );
}
