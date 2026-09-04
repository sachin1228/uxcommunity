"use client";

import { SlidersHorizontal } from "lucide-react";

const FILTERS = ["Newest", "Trending", "Following"] as const;

export function HomeFeedFilters() {
  return (
    <section className="my-2" aria-label="Feed filters">
      <div className="flex items-center justify-center rounded-xl px-4 py-3 md:px-5 md:py-4">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 rounded-full bg-surface-raised p-1"
            role="group"
            aria-label="Feed sorting"
          >
            {FILTERS.map((filter) => {
              const isActive = filter === "Newest";
              return (
                <span
                  key={filter}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-full px-4 py-1.5 font-body text-xs font-semibold uppercase tracking-wide ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-foreground-muted"
                  }`}
                >
                  {filter}
                </span>
              );
            })}
          </div>
          <span
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-foreground-muted shadow-sm transition-shadow hover:shadow-md"
            aria-label="More feed filters"
          >
            <SlidersHorizontal strokeWidth={2.5} size={16} />
          </span>
        </div>
      </div>
    </section>
  );
}
