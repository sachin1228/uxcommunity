"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { BarChart3, Image as ImageIcon, LayoutGrid, Link2, MessagesSquare } from "lucide-react";
import { CommunityFeedList } from "@/components/feeds/CommunityFeedList";
import { CommunityPreviewModal } from "@/components/communities/CommunityPreviewModal";
import { filterChip } from "@/components/communities/filter-chip";
import { communityFeedLayout } from "@/components/communities/feed-layout";
import { CATEGORY_ICONS as THREAD_CATEGORY_ICONS } from "@/components/communities/threads/categoryIcons";
import { CATEGORY_ICONS as SHOWCASE_CATEGORY_ICONS } from "@/components/communities/showcase/categoryIcons";
import { RESOURCE_TYPE_ICONS } from "@/components/communities/resources/resourceTypeIcons";
import { feedItemKind, type FeedItem } from "@/components/feeds/types";
import { applyContentChanges } from "@/lib/communities/content-sync";
import { useContentChanges } from "@/lib/communities/use-content-changes";
import { THREAD_CATEGORIES } from "@/lib/communities/models/threads";
import { SHOWCASE_CATEGORY_OPTIONS } from "@/lib/communities/showcase-categories";
import { RESOURCE_TYPES } from "@/lib/communities/models/resources";
import { filterLibraryItems, type LibraryKind } from "./library-filter";

/** One filter pill: the served vocabulary plus its icon. */
type Chip = { value: string; label: string; icon: ReactNode };

/**
 * The Library's tab and chip vocabularies come from the same single sources
 * the community tabs use (THREAD_CATEGORIES, SHOWCASE_CATEGORY_OPTIONS,
 * RESOURCE_TYPES), so a renamed category can never drift between the composer,
 * the community filter row and the shelf. `Polls` is the one extra thread
 * chip: it selects threads that carry a poll, whatever their category.
 */
const THREAD_CHIPS: Chip[] = [
  { value: "all", label: "All", icon: <LayoutGrid size={14} strokeWidth={2.5} aria-hidden="true" /> },
  ...THREAD_CATEGORIES.map((item) => {
    const Icon = THREAD_CATEGORY_ICONS[item.value];
    return { value: item.value as string, label: item.label, icon: <Icon size={14} strokeWidth={2.5} aria-hidden="true" /> };
  }),
  { value: "poll", label: "Polls", icon: <BarChart3 size={14} strokeWidth={2.5} aria-hidden="true" /> },
];

const SHOWCASE_CHIPS: Chip[] = [
  { value: "all", label: "All", icon: <LayoutGrid size={14} strokeWidth={2.5} aria-hidden="true" /> },
  ...SHOWCASE_CATEGORY_OPTIONS.map((item) => {
    const Icon = SHOWCASE_CATEGORY_ICONS[item.value];
    return { value: item.value as string, label: item.label, icon: <Icon size={14} strokeWidth={2.5} aria-hidden="true" /> };
  }),
];

const RESOURCE_CHIPS: Chip[] = [
  { value: "all", label: "All", icon: <LayoutGrid size={14} strokeWidth={2.5} aria-hidden="true" /> },
  ...RESOURCE_TYPES.map((item) => {
    const Icon = RESOURCE_TYPE_ICONS[item.value];
    return { value: item.value as string, label: item.label, icon: <Icon size={14} strokeWidth={2.5} aria-hidden="true" /> };
  }),
];

const TABS: Array<{ value: LibraryKind; label: string }> = [
  { value: "thread", label: "Threads" },
  { value: "showcase", label: "Showcase" },
  { value: "resource", label: "Resources" },
];

const CHIPS: Record<LibraryKind, Chip[]> = {
  thread: THREAD_CHIPS,
  showcase: SHOWCASE_CHIPS,
  resource: RESOURCE_CHIPS,
};

const EMPTY_STATES: Record<LibraryKind, { icon: typeof MessagesSquare; title: string; description: string }> = {
  thread: {
    icon: MessagesSquare,
    title: "No threads yet",
    description: "Handpicked questions, discussions, ideas and polls from across the community will appear here.",
  },
  showcase: {
    icon: ImageIcon,
    title: "No showcase work yet",
    description: "Handpicked work from every showcase category will appear here.",
  },
  resource: {
    icon: Link2,
    title: "No resources yet",
    description: "Handpicked Figma files, articles, tools and more will appear here.",
  },
};

/**
 * The member Library: the admin's handpicked posts, shelved by kind (Threads,
 * Showcase, Resources) with each kind's own filter row. The cards are the
 * community cards — same components, same mutations to the same API routes as
 * the homepage feed — so a like or save made here lands in the same tables and
 * the content bus keeps every other surface in sync.
 */
export function LibraryView({
  currentUserId,
  initialItems,
}: {
  currentUserId: string;
  /** The server's get_library_page payload, already card-shaped. */
  initialItems: FeedItem[];
}) {
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [kind, setKind] = useState<LibraryKind>("thread");
  const [chip, setChip] = useState<string>("all");
  const [previewCommunityId, setPreviewCommunityId] = useState<string | null>(null);

  const updateItems = useCallback((update: (current: FeedItem[]) => FeedItem[]) => {
    setItems(update);
  }, []);

  // Mutations made elsewhere (a community tab, a card detail page) merge in
  // live, so the shelf never shows a stale copy of a card it shares.
  useContentChanges(null, useCallback((changes) => {
    updateItems((current) => applyContentChanges(current, changes, feedItemKind));
  }, [updateItems]));

  const visible = useMemo(() => filterLibraryItems(items, kind, chip), [items, kind, chip]);

  const empty = EMPTY_STATES[kind];
  const EmptyIcon = empty.icon;

  return (
    <>
      {previewCommunityId && (
        <CommunityPreviewModal
          communityId={previewCommunityId}
          onClose={() => setPreviewCommunityId(null)}
        />
      )}

      <div className={communityFeedLayout.pageHeaderWithFilters}>
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-foreground">Library</h1>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              Handpicked questions, discussions, polls, showcase work and resources from across the community.
            </p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Library sections"
          className="mt-5 flex items-center gap-1 overflow-x-auto border-b border-border md:gap-3"
        >
          {TABS.map((tab) => {
            const active = kind === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setKind(tab.value);
                  setChip("all");
                }}
                className={`border-b-2 px-3 py-2.5 font-body text-xs transition-colors ${
                  active
                    ? "border-accent text-foreground"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className={`${communityFeedLayout.pageHeaderFilters} flex items-center gap-2 overflow-x-auto pb-1`}>
          {CHIPS[kind].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setChip(item.value)}
              aria-pressed={chip === item.value}
              className={filterChip(chip === item.value)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <CommunityFeedList
        items={visible}
        currentUserId={currentUserId}
        onChange={updateItems}
        onOpenCommunityPreview={setPreviewCommunityId}
        emptyState={(
          <div className={communityFeedLayout.emptyState}>
            <EmptyIcon strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>{empty.title}</h3>
            <p className={communityFeedLayout.emptyDescription}>{empty.description}</p>
          </div>
        )}
      />
    </>
  );
}
