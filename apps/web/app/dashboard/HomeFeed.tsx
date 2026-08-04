"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe } from "lucide-react";

import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import { EventCard } from "@/components/communities/events/EventCard";
import { ResourceCard } from "@/components/communities/resources/ResourceCard";
import type { CommunityThread } from "@/components/communities/threads/types";
import type { CommunityEvent } from "@/components/communities/events/types";
import type { CommunityResource } from "@/components/communities/resources/types";

// Feed item as returned by /api/home/feed — typed union
type FeedThread   = CommunityThread   & { _type: "thread";   community_name: string | null; community_image: string | null };
type FeedEvent    = CommunityEvent    & { _type: "event";    community_name: string | null; community_image: string | null };
type FeedResource = CommunityResource & { _type: "resource"; community_name: string | null; community_image: string | null };
type FeedItem = FeedThread | FeedEvent | FeedResource;

interface HomeFeedProps {
  currentUserId: string;
}

export function HomeFeed({ currentUserId }: HomeFeedProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/home/feed")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.items) setItems(d.items); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const handleThreadUpdated = useCallback((updated: CommunityThread) => {
    setItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === updated.id ? { ...it, ...updated } : it
    ));
  }, []);

  const handleThreadVoteChanged = useCallback((id: string, voted: boolean, count: number) => {
    setItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id
        ? { ...it, user_voted: voted, vote_count: count }
        : it
    ));
  }, []);

  const handleThreadSaveChanged = useCallback((id: string, saved: boolean) => {
    setItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id ? { ...it, user_saved: saved } : it
    ));
  }, []);

  const handleThreadDeleted = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => !(it._type === "thread" && it.id === id)));
  }, []);

  const handleEventUpdated = useCallback((updated: CommunityEvent) => {
    setItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === updated.id ? { ...it, ...updated } : it
    ));
  }, []);

  const handleEventDeleted = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => !(it._type === "event" && it.id === id)));
  }, []);

  const handleEventRsvpChanged = useCallback((id: string, rsvped: boolean, count: number) => {
    setItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_rsvped: rsvped, rsvp_count: count }
        : it
    ));
  }, []);

  const handleEventSaveChanged = useCallback((id: string, saved: boolean, count: number) => {
    setItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_saved: saved, save_count: count }
        : it
    ));
  }, []);

  const handleResourceUpdated = useCallback((updated: CommunityResource) => {
    setItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === updated.id ? { ...it, ...updated } : it
    ));
  }, []);

  const handleResourceSaveChanged = useCallback((id: string, saved: boolean, count: number) => {
    setItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === id
        ? { ...it, user_saved: saved, save_count: count }
        : it
    ));
  }, []);

  const handleResourceBookmarkChanged = useCallback((id: string, bookmarked: boolean, count: number) => {
    setItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === id
        ? { ...it, user_bookmarked: bookmarked, bookmark_count: count }
        : it
    ));
  }, []);

  const handleResourceDeleted = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => !(it._type === "resource" && it.id === id)));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <ul className="border-t border-border animate-pulse">
        {[1, 2, 3].map((item) => (
          <li key={item} className="border-b border-border px-8 py-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-surface-raised" />
              <div className="flex items-center gap-2">
                <div className="h-3 w-20 rounded bg-surface-raised" />
                <div className="h-3 w-12 rounded bg-surface-raised" />
                <div className="h-5 w-16 rounded-full bg-surface-raised" />
              </div>
            </div>
            <div className="mt-4 h-4 w-3/4 rounded bg-surface-raised" />
            <div className="mt-2.5 space-y-2">
              <div className="h-3 w-full rounded bg-surface-raised" />
              <div className="h-3 w-5/6 rounded bg-surface-raised" />
              <div className="h-3 w-2/3 rounded bg-surface-raised" />
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="h-8 w-8 rounded-full bg-surface-raised" />
              <div className="h-3 w-6 rounded bg-surface-raised" />
              <div className="h-3 w-20 rounded bg-surface-raised" />
            </div>
          </li>
        ))}
        {/* Article grid skeleton row */}
        <li className="border-b border-border">
          <div className="grid grid-cols-2 gap-4 p-4">
            {[1, 2].map((item) => (
              <div key={item} className="rounded-2xl border border-border p-5">
                <div className="h-32 w-full rounded-xl bg-surface-raised mb-4" />
                <div className="h-3 w-20 rounded bg-surface-raised mb-3" />
                <div className="h-4 w-3/4 rounded bg-surface-raised" />
                <div className="mt-2 space-y-1.5">
                  <div className="h-3 w-full rounded bg-surface-raised" />
                  <div className="h-3 w-4/5 rounded bg-surface-raised" />
                </div>
              </div>
            ))}
          </div>
        </li>
      </ul>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Globe size={32} className="mb-3 text-foreground-subtle" />
        <p className="font-body text-sm font-medium text-foreground-muted">Nothing public yet</p>
        <p className="mt-1 max-w-xs font-body text-xs text-foreground-subtle">
          When community members share threads, events, or resources publicly, they&apos;ll appear here.
        </p>
      </div>
    );
  }

  // Group items so consecutive resources are batched together into a
  // 2-column grid, while threads and events stay full-width.
  type Group =
    | { kind: "thread"; item: FeedThread }
    | { kind: "event";  item: FeedEvent }
    | { kind: "resources"; items: FeedResource[] };

  const groups: Group[] = [];
  for (const item of items) {
    if (item._type === "resource") {
      const last = groups[groups.length - 1];
      if (last?.kind === "resources") {
        last.items.push(item);
      } else {
        groups.push({ kind: "resources", items: [item] });
      }
    } else if (item._type === "thread") {
      groups.push({ kind: "thread", item });
    } else {
      groups.push({ kind: "event", item });
    }
  }

  return (
    <ul className="border-t border-border">
      {groups.map((group, gi) => {
        const isLastGroup = gi === groups.length - 1;

        if (group.kind === "thread") {
          return (
            <li key={`thread-${group.item.id}`}>
              <ThreadCard
                thread={group.item}
                currentUserId={currentUserId}
                communityId={group.item.community_id}
                communityName={group.item.community_name ?? undefined}
                detailHref={`/dashboard/threads/${group.item.id}`}
                onUpdated={handleThreadUpdated}
                onVoteChanged={handleThreadVoteChanged}
                onSaveChanged={handleThreadSaveChanged}
                onDeleted={handleThreadDeleted}
                isLast={isLastGroup}
              />
            </li>
          );
        }

        if (group.kind === "event") {
          return (
            <li key={`event-${group.item.id}`} className={isLastGroup ? "" : "border-b border-border"}>
              <div className="px-8 py-6">
                {group.item.community_name && (
                  <p className="mb-2 font-body text-[11px] text-foreground-subtle">
                    in <span className="text-foreground-muted">{group.item.community_name}</span>
                  </p>
                )}
                <EventCard
                  event={group.item}
                  currentUserId={currentUserId}
                  communityId={group.item.community_id}
                  detailHref={`/dashboard/events/${group.item.id}`}
                  onUpdated={handleEventUpdated}
                  onDeleted={handleEventDeleted}
                  onRsvpChanged={handleEventRsvpChanged}
                  onSaveChanged={handleEventSaveChanged}
                />
              </div>
            </li>
          );
        }

        // ── Resource group — 2-column grid ────────────────────────────────
        const resources = group.items;
        const isOdd = resources.length % 2 !== 0;
        return (
          <li key={`resources-${gi}`} className={isLastGroup ? "" : "border-b border-border"}>
            <div className="grid grid-cols-2 gap-4 px-8 py-6">
              {resources.map((res) => (
                <div key={`resource-${res.id}`} className="overflow-hidden">
                  {res.community_name && (
                    <div className="mb-2 flex items-center gap-1.5 font-body text-[11px] text-foreground-subtle">
                      <span>posted in</span>
                      {res.community_image ? (
                        <img
                          src={res.community_image}
                          alt={res.community_name}
                          className="h-4 w-4 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-4 w-4 rounded-full bg-accent/20 shrink-0" />
                      )}
                      <span className="text-foreground-muted">{res.community_name}</span>
                    </div>
                  )}
                  <ResourceCard
                    resource={res}
                    currentUserId={currentUserId}
                    communityId={res.community_id}
                    onUpdated={handleResourceUpdated}
                    onSaveChanged={handleResourceSaveChanged}
                    onBookmarkChanged={handleResourceBookmarkChanged}
                    onDeleted={handleResourceDeleted}
                  />
                </div>
              ))}
              {/* Placeholder for the empty second column when count is odd */}
              {isOdd && (
                <div className="rounded-2xl flex flex-col items-center justify-center gap-2 p-8 min-h-[200px]">
                  <p className="font-body text-sm font-medium text-foreground-muted">More articles coming soon</p>
                  <p className="font-body text-xs text-foreground-subtle">Check back later for new content.</p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
