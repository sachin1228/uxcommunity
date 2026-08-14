"use client";

/**
 * BackLink
 *
 * Deterministic "back to list" link for detail pages (threads, events,
 * showcase, resources, home-feed cards). It always navigates to the explicit
 * `href` — the list/tab page the label promises — instead of relying on
 * `router.back()`.
 *
 * History-based back navigation was unreliable here: `window.history.length > 1`
 * is almost always true, and the community tabs update the URL with
 * `history.replaceState` (no new history entry), so the previous history entry
 * is frequently the chat view rather than the list this link points to.
 * Navigating to `href` also handles deep links correctly.
 */

import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { useGuardedRouter } from "@/lib/navigation-guard";

interface BackLinkProps {
  /** Destination — the list/tab page this link returns to. */
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
      router.push(href);
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
