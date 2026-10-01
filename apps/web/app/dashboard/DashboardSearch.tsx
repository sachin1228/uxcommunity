"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertRegular, BriefcaseRegular, CompassNorthwestRegular, HomeRegular, LibraryRegular, SearchRegular, SettingsRegular, PersonCircleRegular, PeopleRegular } from "@fluentui/react-icons";
import { ModalPortal } from "@/components/ui/Modal";
import { sidebarStore } from "@/lib/communities/cache";
import { useGuardedRouter } from "@/lib/navigation-guard";
import {
  searchDestinations,
  type SearchDestination,
  type SearchGroup,
} from "@/lib/dashboard/topbar";

/**
 * The dashboard's search palette.
 *
 * There is no search endpoint in this app, so this deliberately does not fake
 * one: it jumps to the pages the member already has and to the communities the
 * sidebar cache has already fetched. Opening it costs no request, and every
 * row it shows is a real destination.
 *
 * Ranking and the row list live in lib/dashboard/topbar.ts, which is pure and
 * unit-tested.
 */

/** Icon per quick link. Communities share one — they are one kind of place. */
const ICONS: Record<string, typeof SearchRegular> = {
  "/dashboard": HomeRegular,
  "/dashboard/communities": CompassNorthwestRegular,
  "/dashboard/library": LibraryRegular,
  "/dashboard/jobs": BriefcaseRegular,
  "/dashboard/notifications": AlertRegular,
  "/dashboard/profile": PersonCircleRegular,
  "/dashboard/settings": SettingsRegular,
};

const GROUP_LABELS: Record<SearchGroup, string> = {
  page: "Pages",
  community: "Your communities",
};

/** Ids for the listbox's options, so the input can point `aria-activedescendant` at one. */
function optionId(index: number) {
  return `dashboard-search-option-${index}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DashboardSearch({ open, onClose }: Props) {
  const router = useGuardedRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * Snapshot the sidebar cache once per open. Reading it live would re-sort the
   * list under the cursor as realtime previews land, and the sidebar keeps it
   * warm anyway, so there is nothing to fetch here.
   */
  const communities = useMemo(
    () => (open ? sidebarStore.data?.communities ?? [] : []),
    [open],
  );

  const results = useMemo(
    () => searchDestinations(query, communities),
    [query, communities],
  );

  // The palette is mounted fresh on every open — the Topbar renders it only
  // while `open` is true — so the query and cursor already start clean. Focus
  // is the one thing that has to wait for the portal to paint.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // Hold the page still behind the overlay, like the shared Modal does.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Keep the highlighted row in view while arrowing past the fold.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, results]);

  if (!open) return null;

  function go(destination: SearchDestination | undefined) {
    if (!destination) return;
    onClose();
    router.push(destination.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[activeIndex]);
    }
    // Escape is owned by the Topbar, which also owns what opened this.
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[1000]"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />

        <div className="relative mx-auto mt-[10vh] w-[min(38rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <SearchRegular
              fontSize={17}
              className="shrink-0 text-foreground-muted"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // A new query means a new list, so the old highlight would point
                // at a different row than the one the member was looking at.
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search pages and your communities"
              aria-label="Search pages and your communities"
              role="combobox"
              aria-expanded="true"
              aria-controls="dashboard-search-results"
              aria-activedescendant={
                results.length ? optionId(activeIndex) : undefined
              }
              autoComplete="off"
              spellCheck={false}
              className="h-12 min-w-0 flex-1 bg-transparent font-body text-sm text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
          </div>

          <div
            ref={listRef}
            id="dashboard-search-results"
            role="listbox"
            aria-label="Search results"
            className="max-h-[min(24rem,50vh)] overflow-y-auto p-1.5"
          >
            {results.length === 0 ? (
              <p className="px-3 py-8 text-center font-body text-sm text-foreground-muted">
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              results.map((destination, index) => {
                const Icon = ICONS[destination.href] ?? PeopleRegular;
                const active = index === activeIndex;
                // One header per group, emitted on the first row of each.
                const showHeader =
                  index === 0 || results[index - 1].group !== destination.group;

                return (
                  <div key={destination.id}>
                    {showHeader && (
                      <p
                        className="px-3 pb-1 pt-2 font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted"
                        aria-hidden="true"
                      >
                        {GROUP_LABELS[destination.group]}
                      </p>
                    )}
                    <div
                      id={optionId(index)}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onClick={() => go(destination)}
                      onMouseMove={() => {
                        if (!active) setActiveIndex(index);
                      }}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 font-body text-sm transition-colors ${
                        active
                          ? "bg-surface-raised text-foreground"
                          : "text-foreground-muted"
                      }`}
                    >
                      <Icon
                        fontSize={17}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="sr-only">
                          {GROUP_LABELS[destination.group]}:{" "}
                        </span>
                        {destination.label}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div
            className="flex items-center gap-4 border-t border-border px-4 py-2 font-body text-[11px] text-foreground-muted"
            aria-hidden="true"
          >
            <span>↑↓ to navigate</span>
            <span>↵ to open</span>
            <span>esc to close</span>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
