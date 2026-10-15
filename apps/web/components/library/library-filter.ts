import type { FeedItem } from "@/components/feeds/types";

/** The three content kinds the Library shelves, in tab order. */
export const LIBRARY_KINDS = ["thread", "showcase", "resource"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/**
 * Filters the shelf's cards for one tab and one chip.
 *
 * `all` keeps every card of the kind. Each kind's chips otherwise carry its own
 * vocabulary — a thread category ("question" … "feedback"), a showcase category,
 * a resource type. The one exception is the thread chip `poll`, which is not a
 * category at all: it selects the threads that carry a poll, whatever their
 * category.
 */
export function filterLibraryItems(items: FeedItem[], kind: LibraryKind, chip: string): FeedItem[] {
  return items.filter((item) => {
    if (chip === "all") return item._type === kind;
    if (kind === "thread") {
      if (item._type !== "thread") return false;
      return chip === "poll" ? Boolean(item.poll) : item.category === chip;
    }
    if (kind === "showcase") return item._type === "showcase" && item.category === chip;
    return item._type === "resource" && item.resource_type === chip;
  });
}
