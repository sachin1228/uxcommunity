"use client";

import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * The shared end-of-list loader every feed uses: a sentinel below the last
 * card pulls the next page in as it scrolls into view, so no feed carries its
 * own button. The members list and the chat already auto-load the same way —
 * this is that pattern, spelled once and given the same row everywhere: a
 * centered spinner while the page is on its way in, nothing once the feed has
 * run out.
 */
export function FeedLoadMore({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  /** Called when the sentinel scrolls into view; surfaces guard re-entry. */
  onLoadMore: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onLoadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore]);

  if (!hasMore) return null;

  return (
    <div ref={sentinelRef} className="flex items-center justify-center py-6">
      {loading && (
        <div role="status" aria-label="Loading more">
          <Spinner size={18} />
        </div>
      )}
    </div>
  );
}
