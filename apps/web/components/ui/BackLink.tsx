"use client";

/**
 * BackLink
 *
 * Detail-page back links used to be plain `<Link href={backHref}>`, which made
 * every "back" click re-run the destination page's server render (and re-fetch
 * its data). When the user reached the detail page through the app, this
 * instead uses `router.back()` — Next.js restores the previous page from its
 * router cache with zero new requests.
 *
 * Falls back to navigating to `href` when there is no in-app history to go back
 * to (e.g. the detail page was opened directly / deep-linked), and lets
 * modifier-clicks (open in new tab) behave normally.
 */

import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { useGuardedRouter } from "@/lib/navigation-guard";

interface BackLinkProps {
  /** Fallback destination when there is no in-app history to go back to. */
  href: string;
  label?: string;
  className?: string;
}

export function BackLink({ href, label = "Home", className }: BackLinkProps) {
  const router = useGuardedRouter();

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Only intercept plain left-clicks — let ctrl/cmd/shift/middle clicks
      // (open in new tab, etc.) fall through to the native anchor behavior.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();

      if (typeof window !== "undefined" && window.history.length > 1) {
        // The previous entry is in this tab's session — restore it from the
        // Next.js router cache instead of re-rendering the page.
        router.back();
      } else {
        router.push(href);
      }
    },
    [router, href],
  );

  return (
    <a
      href={href}
      onClick={handleClick}
      className={className}
    >
      <ArrowLeft size={14} />
      {label}
    </a>
  );
}
