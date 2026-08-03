"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe, Loader2 } from "lucide-react";

import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import { EventCard } from "@/components/communities/events/EventCard";
import { ResourceCard } from "@/components/communities/resources/ResourceCard";
import type { CommunityThread } from "@/components/communities/threads/types";
import type { CommunityEvent } from "@/components/communities/events/types";
import type { CommunityResource } from "@/components/communities/resources/types";

// Feed item as returned by /api/home/feed — typed union
type FeedThread   = CommunityThread & { _type: "thread";   community_name: string | null };
type FeedEvent    = CommunityEvent  & { _type: "event";    community_name: string | null };
type FeedResource = CommunityResource & { _type: "resource"; community_name: string | null };
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
      <div className="flex items-center justify-center py-20">
        <Loader2 size={18} className="animate-spin text-foreground-muted" />
      </div>
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

  return (
    <ul className="border-t border-border">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;

        if (item._type === "thread") {
          return (
            <li key={`thread-${item.id}`}>
              <ThreadCard
                thread={item}
                currentUserId={currentUserId}
                communityId={item.community_id}
                communityName={item.community_name ?? undefined}
                detailHref={`/dashboard/threads/${item.id}`}
                onUpdated={handleThreadUpdated}
                onVoteChanged={handleThreadVoteChanged}
                onSaveChanged={handleThreadSaveChanged}
                onDeleted={handleThreadDeleted}
                isLast={isLast}
              />
            </li>
          );
        }

        if (item._type === "event") {
          return (
            <li key={`event-${item.id}`} className={isLast ? "" : "border-b border-border"}>
              <div className="py-8 px-8">
                {item.community_name && (
                  <p className="mb-2 font-body text-[11px] text-foreground-subtle">
                    in <span className="text-foreground-muted">{item.community_name}</span>
                  </p>
                )}
                <EventCard
                  event={item}
                  currentUserId={currentUserId}
                  communityId={item.community_id}
                  detailHref={`/dashboard/events/${item.id}`}
                  onUpdated={handleEventUpdated}
                  onDeleted={handleEventDeleted}
                  onRsvpChanged={handleEventRsvpChanged}
                  onSaveChanged={handleEventSaveChanged}
                />
              </div>
            </li>
          );
        }

        // resource
        return (
          <li key={`resource-${item.id}`} className={isLast ? "" : "border-b border-border"}>
            <div className="py-8 px-8">
              {item.community_name && (
                <p className="mb-2 font-body text-[11px] text-foreground-subtle">
                  in <span className="text-foreground-muted">{item.community_name}</span>
                </p>
              )}
              <ResourceCard
                resource={item}
                currentUserId={currentUserId}
                communityId={item.community_id}
                onUpdated={handleResourceUpdated}
                onSaveChanged={handleResourceSaveChanged}
                onBookmarkChanged={handleResourceBookmarkChanged}
                onDeleted={handleResourceDeleted}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
