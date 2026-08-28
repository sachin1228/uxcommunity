"use client";

import { SlidersHorizontal } from "lucide-react";
import { communityFeedLayout } from "@/components/communities/feed-layout";

const FILTERS = ["Newest", "Trending", "Following"] as const;

export function HomeFeedFilters() {
  return (
    <section className="my-2" aria-label="Feed filters">
      <div className={`${communityFeedLayout.card} flex items-center justify-center py-4 md:py-5`}>
        <div className="flex max-w-full items-center gap-3">
          <div className="flex overflow-hidden rounded-full border border-border-strong bg-surface-raised" role="group" aria-label="Feed sorting">
            {FILTERS.map((filter, index) => (
              <span
                key={filter}
                aria-current={filter === "Newest" ? "page" : undefined}
                className={`px-4 py-2.5 font-body text-sm font-semibold uppercase tracking-wide sm:px-6 sm:text-base ${
                  index > 0 ? "border-l border-border-strong" : ""
                } ${filter === "Newest" ? "bg-accent/10 text-accent" : "text-foreground-muted"}`}
              >
                {filter}
              </span>
            ))}
          </div>
          <span
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-foreground-muted"
            aria-label="More feed filters"
          >
            <SlidersHorizontal size={18} />
          </span>
        </div>
      </div>
    </section>
  );
}
