"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookMarked,
  Bookmark,
  Calendar,
  LayoutGrid,
  MessagesSquare,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { CommunityFeedList } from "./CommunityFeedList";
import { FEED_PAGE_SIZE, feedItemKind, type FeedItem } from "./types";
import { Spinner } from "@/components/ui/Spinner";
import {
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  invalidateRequest,
  patchCachedRequest,
} from "@/lib/request-cache";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import {
  applyContentChanges,
  changeNeedsRefetch,
  type ContentChange,
} from "@/lib/communities/content-sync";
import { useContentChanges } from "@/lib/communities/use-content-changes";
import { PROFILE_FEED_SCOPES, isProfileFeedScope, type ProfileFeedScope } from "@/lib/supabase/performance-rpcs";

/** One profile activity tab per card scope the profile feed RPC serves. */
export type ProfileActivityTab = ProfileFeedScope;

const TAB_META: Record<ProfileActivityTab, { label: string; icon: LucideIcon }> = {
  all: { label: "All", icon: LayoutGrid },
  thread: { label: "Threads", icon: MessagesSquare },
  showcase: { label: "Showcase", icon: Sparkles },
  resource: { label: "Resources", icon: BookMarked },
  event: { label: "Events", icon: Calendar },
  saved: { label: "Saved", icon: Bookmark },
};

// Derived from the scopes constant, so a new scope cannot ship without a tab
// (and the Record above fails to type-check until it has one).
export const PROFILE_ACTIVITY_TABS = PROFILE_FEED_SCOPES.map((value) => ({
  value,
  ...TAB_META[value],
}));

const PROFILE_FEED_STALE_MS = 30_000;

const EMPTY_STATE: Record<ProfileActivityTab, { title: string; body: string }> = {
  all: {
    title: "Nothing here yet",
    body: "Threads, showcase posts, resources and events you create or save will appear here.",
  },
  thread: {
    title: "No threads yet",
    body: "Threads you start or save in a community will appear here.",
  },
  showcase: {
    title: "No showcase posts yet",
    body: "Work you share or save in a community showcase will appear here.",
  },
  resource: {
    title: "No resources yet",
    body: "Resources you share or save in a community will appear here.",
  },
  event: {
    title: "No events yet",
    body: "Events you host or save in a community will appear here.",
  },
  saved: {
    title: "Nothing saved yet",
    body: "Save a thread, event, resource or showcase post and it will appear here.",
  },
};

function emptyStateFor(tab: ProfileActivityTab) {
  const copy = EMPTY_STATE[tab];
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="font-body text-sm font-medium text-foreground-muted">{copy.title}</p>
      <p className="mt-1 max-w-xs font-body text-xs text-foreground-subtle">{copy.body}</p>
    </div>
  );
}

/**
 * One tab's page of cards. Mounted only while its tab is active (like the
 * community tab views), so each scope fetches, paginates and caches on its own
 * endpoint and switching tabs is instant once a scope has been opened.
 */
function ProfileActivityScope({
  scope,
  currentUserId,
}: {
  scope: ProfileActivityTab;
  currentUserId: string;
}) {
  initRequestCache(currentUserId);
  const requestUrl = `/api/profile/feed?scope=${scope}`;
  const cached = getCachedRequest<{ items?: FeedItem[] }>(requestUrl, currentUserId);
  const [items, setItems] = useState<FeedItem[]>(() => cached?.items ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(() => (cached?.items?.length ?? 0) >= FEED_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchItems = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ items?: FeedItem[] }>(
        requestUrl,
        { staleMs: PROFILE_FEED_STALE_MS, force },
        currentUserId,
      );
      setItems(data.items ?? []);
      setHasMore((data.items?.length ?? 0) >= FEED_PAGE_SIZE);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load your posts.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, requestUrl]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchItems(true), 0);
    return () => window.clearTimeout(initialFetch);
  }, [fetchItems]);

  // The profile has no realtime channel; long absences miss nothing here but
  // short ones do (a save made in another window), so refetch on return.
  useHiddenCatchUp(() => void fetchItems(true));

  const updateItems = useCallback((update: (current: FeedItem[]) => FeedItem[]) => {
    setItems((current) => {
      const next = update(current);
      patchCachedRequest<{ items?: FeedItem[] }>(
        requestUrl,
        (cachedPage) => ({ ...cachedPage, items: next }),
        currentUserId,
      );
      return next;
    });
  }, [currentUserId, requestUrl]);

  // Same bus as the homepage feed: merge what other surfaces changed.
  //
  // These tabs are membership lists ("mine or saved by me"), so a change can do
  // more than edit a card: it can mean the card no longer belongs here at all.
  // Unsaving a post that is only in the list because it was saved drops it
  // immediately; everything else that changes *which* cards belong (a new post,
  // a delete, saving a post this tab has never listed) pulls the page again
  // instead of patching.
  const onContentChanges = useCallback((changes: ContentChange[]) => {
    const unsavedIds = new Set(
      changes.filter((change) => change.patch?.user_saved === false).map((change) => change.id),
    );

    updateItems((current) => {
      const merged = applyContentChanges(current, changes, feedItemKind);
      const inScope = (item: FeedItem) =>
        scope !== "saved" || Boolean(item.user_saved);
      if (!unsavedIds.size) return merged.filter(inScope);
      return merged.filter((item) => inScope(item) && (item.user_id === currentUserId || !unsavedIds.has(item.id)));
    });

    const needsRefetch = changes.some((change) => {
      const isMineOrEveryKind = change.kind === scope || scope === "all" || scope === "saved";
      return isMineOrEveryKind && changeNeedsRefetch(change);
    });
    if (needsRefetch) {
      invalidateRequest(requestUrl, currentUserId);
      void fetchItems(true, true);
    }
  }, [currentUserId, fetchItems, requestUrl, scope, updateItems]);

  useContentChanges(null, onContentChanges);

  const loadMore = useCallback(async () => {
    if (loadingMore || !items.length) return;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const response = await fetch(
        `${requestUrl}&before=${encodeURIComponent(last.created_at)}`,
      );
      if (!response.ok) return;
      const data = await response.json() as { items?: FeedItem[] };
      const incoming = data.items ?? [];
      updateItems((prev) => {
        const ids = new Set(prev.map((item) => item.id));
        return [...prev, ...incoming.filter((item) => !ids.has(item.id))];
      });
      setHasMore(incoming.length >= FEED_PAGE_SIZE);
    } catch {
      // Network error — leave the page as-is.
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, requestUrl, updateItems]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" role="status" aria-label="Loading posts">
        <Spinner size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="font-body text-sm font-medium text-red-400">Couldn&apos;t load your posts</p>
        <p className="max-w-sm font-body text-xs text-foreground-subtle">{error}</p>
        <button
          type="button"
          onClick={() => void fetchItems(false, true)}
          className="mt-1 rounded-lg border border-border px-4 py-1.5 font-body text-xs text-foreground hover:bg-surface-raised"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <CommunityFeedList
        items={items}
        currentUserId={currentUserId}
        onChange={updateItems}
        emptyState={emptyStateFor(scope)}
        showPastEvents
      />

      {items.length > 0 && hasMore && (
        <div className="flex justify-center border-t border-border py-6">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground hover:bg-surface-raised disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load older posts"}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The activity tabs on the profile page: everything the member created, split
 * by card type, plus everything they saved. Cards are the community cards —
 * rendered by the same components and persisted through the same API routes as
 * the homepage feed and the community tabs, so an edit here immediately shows
 * there (and vice versa) and always lands in the database.
 */
export function ProfileActivityFeed({
  currentUserId,
  initialTab = "all",
  basePath = "/dashboard/profile",
}: {
  currentUserId: string;
  initialTab?: ProfileActivityTab;
  basePath?: string;
}) {
  const [activeTab, setActiveTab] = useState<ProfileActivityTab>(initialTab);

  const handleTabChange = useCallback((tab: ProfileActivityTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    const query = params.toString();
    const url = query ? `${basePath}?${query}` : basePath;

    // Tabs are local views of the same mounted profile page: pushState keeps
    // them shareable and returns Back to the previous tab without a navigation.
    if (url !== window.location.pathname + window.location.search) {
      window.history.pushState({ profileTab: tab }, "", url);
    }
  }, [basePath]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const match = /[?&]tab=([a-z]+)/.exec(window.location.search);
      const tab = match?.[1] ?? "all";
      if (!isProfileFeedScope(tab)) return;
      setActiveTab(tab);
      if (event.state?.profileTab !== tab) {
        window.history.replaceState({ profileTab: tab }, "");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <section aria-label="Your activity" className="mt-2">
      <nav
        role="tablist"
        aria-label="Your posts"
        className="flex items-center gap-1 overflow-x-auto border-b border-border md:gap-3"
      >
        {PROFILE_ACTIVITY_TABS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activeTab === value}
            onClick={() => handleTabChange(value)}
            className={`border-b-2 px-3 py-2.5 font-body text-xs transition-colors ${
              activeTab === value
                ? "border-accent text-foreground"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
              {label}
            </span>
          </button>
        ))}
      </nav>

      <div className="pt-4">
        <ProfileActivityScope key={activeTab} scope={activeTab} currentUserId={currentUserId} />
      </div>
    </section>
  );
}
