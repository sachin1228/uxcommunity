"use client";

import { useRouter } from "next/navigation";
import { LayoutGrid, Palette } from "lucide-react";
import { EntryCard } from "./EntryCard";
import { EmptyState } from "./CompetitionChrome";
import type { CompetitionEntry } from "@/lib/competitions/types";

type SortKey = "recent" | "oldest" | "votes" | "featured";

interface Props {
  slug: string;
  entries: CompetitionEntry[];
  currentUserId: string;
  votingOpen: boolean;
  /** Ranking by votes only makes sense once voting has closed. */
  rankingOpen: boolean;
  sort: SortKey;
  /** The viewer's own entry id, so their work is labelled in the gallery. */
  myEntryId?: string | null;
  emptyAction?: React.ReactNode;
}

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "recent", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "featured", label: "Editors' picks" },
  { key: "votes", label: "Most voted" },
];

/**
 * The design showcase.
 *
 * A masonry gallery, not a feed: every card is artwork first, and the columns
 * let tall and wide designs keep their own proportions instead of being
 * cropped into a uniform grid. On mobile it collapses to a single column with
 * full-bleed previews, which is how a designer actually wants to look at work.
 */
export function EntryGrid({
  slug,
  entries,
  currentUserId,
  votingOpen,
  rankingOpen,
  sort,
  myEntryId,
  emptyAction,
}: Props) {
  const router = useRouter();
  const available = SORTS.filter((option) => option.key !== "votes" || rankingOpen);

  function changeSort(next: SortKey) {
    const query = next === "recent" ? "" : `?sort=${next}`;
    router.push(`/dashboard/competitions/${slug}${query}#entries`, { scroll: false });
  }

  if (!entries.length) {
    return (
      <EmptyState
        icon={<Palette size={26} strokeWidth={2} />}
        title="No designs yet"
        hint="This week's gallery is empty. Be the first to put your work on the wall."
        action={emptyAction}
      />
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
          <LayoutGrid size={13} strokeWidth={2.5} />
          {entries.length} {entries.length === 1 ? "design" : "designs"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {available.map((option) => {
            const active = option.key === sort;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => changeSort(option.key)}
                aria-pressed={active}
                className={`rounded-full px-2.5 py-1.5 font-body text-[11px] font-semibold transition-colors ${
                  active
                    ? "bg-surface-raised text-foreground shadow-xs"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {!rankingOpen && (
        <p className="mb-4 font-body text-xs text-foreground-muted">
          Entries are shown as they arrive so nobody designs to a scoreboard. Voting results are
          revealed on results day.
        </p>
      )}

      <div className="columns-1 gap-5 sm:columns-2 xl:columns-3">
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            slug={slug}
            entry={entry}
            currentUserId={currentUserId}
            votingOpen={votingOpen}
            emphasis={entry.is_featured ? "featured" : "none"}
          />
        ))}
      </div>

      {myEntryId && (
        <p className="mt-2 font-body text-xs text-foreground-subtle">
          Your entry is in the gallery above.
        </p>
      )}
    </div>
  );
}
