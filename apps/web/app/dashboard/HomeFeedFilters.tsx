"use client";

import { SlidersHorizontal } from "lucide-react";

const FILTERS = ["Newest", "Trending", "Following"] as const;

export function HomeFeedFilters() {
  return (
    <section className="my-2" aria-label="Feed filters">
      <div className="flex items-center justify-center rounded-xl border border-border bg-surface px-4 py-3 md:px-5 md:py-4">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center rounded-xl bg-surface-raised"
            role="group"
            aria-label="Feed sorting"
          >
            {FILTERS.map((filter) => (
              <span
                key={filter}
                aria-current={filter === "Newest" ? "page" : undefined}
                className={`px-4 py-2 font-body text-xs font-semibold uppercase tracking-wide ${
                  filter === "Newest"
                    ? "text-accent"
                    : "text-foreground-muted"
                }`}
              >
                {filter}
              </span>
            ))}
          </div>
          <span
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-foreground-muted shadow-sm transition-shadow hover:shadow-md"
            aria-label="More feed filters"
          >
            <SlidersHorizontal size={16} />
          </span>
        </div>
      </div>
    </section>
  );
}
