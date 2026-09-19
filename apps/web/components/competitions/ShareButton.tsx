"use client";

import { useCallback, useState } from "react";
import { Check, Share2 } from "lucide-react";

interface Props {
  /** Path or absolute URL to share. Paths are resolved against the current origin. */
  url: string;
  title: string;
  /** "icon" for the card overlay, "button" for the detail action row. */
  variant?: "icon" | "button";
  className?: string;
}

/**
 * Share an entry.
 *
 * Uses the native share sheet where the platform has one (which is what
 * designers on mobile expect) and falls back to copying the link. The copy path
 * also covers desktop Safari/Firefox where `navigator.share` is absent.
 */
export function ShareButton({ url, title, variant = "icon", className = "" }: Props) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  const share = useCallback(async () => {
    const absolute = url.startsWith("http")
      ? url
      : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url: absolute });
        return;
      }
      await navigator.clipboard.writeText(absolute);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      // The user dismissed the share sheet, or the clipboard was blocked —
      // neither is worth an error message.
      setState("idle");
    }
  }, [title, url]);

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={() => void share()}
        aria-label="Share this entry"
        className={`inline-flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 font-body text-xs font-semibold text-foreground-muted shadow-xs transition-colors hover:text-foreground ${className}`}
      >
        {state === "copied" ? <Check size={15} strokeWidth={2.5} /> : <Share2 size={15} strokeWidth={2.5} />}
        {state === "copied" ? "Link copied" : "Share"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void share();
      }}
      aria-label="Share this entry"
      className={className}
    >
      {state === "copied" ? <Check size={15} strokeWidth={2.5} /> : <Share2 size={15} strokeWidth={2.5} />}
    </button>
  );
}
