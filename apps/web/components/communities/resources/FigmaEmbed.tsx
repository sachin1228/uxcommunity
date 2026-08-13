"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { getFigmaEmbedUrl } from "@/lib/communities/figma";

interface FigmaEmbedProps {
  url: string;
  className?: string;
  compact?: boolean;
}

export function FigmaEmbed({ url, className = "", compact = false }: FigmaEmbedProps) {
  const embedUrl = useMemo(() => getFigmaEmbedUrl(url), [url]);
  const [loaded, setLoaded] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoaded(false);
    setShowRecovery(false);
    const timeout = window.setTimeout(() => setShowRecovery(true), 8_000);
    return () => window.clearTimeout(timeout);
  }, [embedUrl, reloadKey]);

  if (!embedUrl) return null;

  function reloadPrototype() {
    setReloadKey((current) => current + 1);
  }

  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-surface-raised ${className}`}>
      <div className={`relative w-full ${compact ? "aspect-[4/3] sm:aspect-video" : "aspect-[4/3] md:aspect-video"}`}>
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-foreground-muted">
            <Loader2 size={16} className="animate-spin" />
            <span className="font-body text-sm">Loading Figma prototype…</span>
          </div>
        )}
        <iframe
          key={reloadKey}
          src={embedUrl}
          title="Interactive Figma prototype"
          loading="lazy"
          allowFullScreen
          allow="fullscreen; clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full border-0"
        />
        {showRecovery && (
          <div className="absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface/95 p-3 shadow-lg backdrop-blur-sm">
            <p className="font-body text-xs text-foreground-muted">
              Prototype not visible? Retry, or open it directly if the owner has not enabled Figma embedding.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reloadPrototype}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-body text-xs font-medium text-foreground hover:bg-surface-raised"
              >
                <RefreshCw size={12} /> Retry
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-accent px-2 font-body text-xs font-medium text-accent-foreground hover:bg-accent-hover"
              >
                Open in Figma <ExternalLink size={12} />
              </a>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <span className="font-body text-xs text-foreground-muted">Interactive prototype</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-8 items-center gap-1.5 font-body text-xs font-medium text-accent hover:text-accent-hover"
        >
          Open in Figma <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
