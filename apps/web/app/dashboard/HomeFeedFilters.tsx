"use client";

import { SlidersHorizontal } from "lucide-react";

const FILTERS = ["Newest", "Trending", "Following"] as const;

export function HomeFeedFilters() {
  return (
    <section className="my-2" aria-label="Feed filters">
      <div className="flex items-center justify-center overflow-hidden rounded-xl border border-border bg-surface px-4 py-3 md:px-5 md:py-4">
        <div className="flex max-w-full items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-border-strong bg-surface-raised" role="group" aria-label="Feed sorting">
            {FILTERS.map((filter, index) => (
              <span
                key={filter}
                aria-current={filter === "Newest" ? "page" : undefined}
                className={`px-3 py-2 font-body text-xs font-semibold uppercase tracking-wide sm:px-5 sm:text-sm ${
                  index > 0 ? "border-l border-border-strong" : ""
                } ${filter === "Newest" ? "bg-accent/10 text-accent" : "text-foreground-muted"}`}
              >
                {filter}
              </span>
            ))}
          </div>
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-foreground-muted"
            aria-label="More feed filters"
          >
            <SlidersHorizontal size={16} />
          </span>
        </div>
      </div>
    </section>
  );
}
