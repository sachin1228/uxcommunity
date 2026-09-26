"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import { EventCard } from "@/components/communities/events/EventCard";
import { ResourceCard } from "@/components/communities/resources/ResourceCard";
import { ShowcaseCard } from "@/components/communities/showcase/ShowcaseCard";
import { CreateShowcaseModal } from "@/components/communities/showcase/CreateShowcaseModal";
import type { CommunityThread } from "@/lib/communities/models/threads";
import type { CommunityEvent, EventRsvp } from "@/lib/communities/models/events";
import type { CommunityResource } from "@/lib/communities/models/resources";
import type { ShowcasePost } from "@/components/communities/showcase/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { publishContentChange } from "@/lib/communities/content-sync";
import {
  feedCardWrapperClassName,
  type FeedEvent,
  type FeedItem,
  type FeedResource,
  type FeedShowcase,
} from "./types";

interface CommunityFeedListProps {
  items: FeedItem[];
  currentUserId: string;
  /**
   * Persists a local update into the owning feed's state *and* its request
   * cache. Both feeds pass their own `updateItems`, so a card mutation made
   * here is written through to the cache the other surface reads.
   */
  onChange: (update: (current: FeedItem[]) => FeedItem[]) => void;
  /** Shown when there is nothing to render (copy differs per surface). */
  emptyState?: ReactNode;
  /**
   * Ended events are hidden from the home feed but shown on the profile
   * activity tabs, where the Events tab is the member's event history.
   */
  showPastEvents?: boolean;
  /**
   * Homepage only: clicking a card's "posted in …" label opens the
   * community preview popup here instead of navigating to the community.
   */
  onOpenCommunityPreview?: (communityId: string) => void;
}

/**
 * The community card list.
 *
 * Renders the four community cards exactly as the community tabs do — same
 * components, same props, therefore the same like/save/RSVP/poll/edit/delete
 * requests to the same API routes. Every confirmed mutation is published on the
 * content-sync bus, so the homepage feed, the profile tabs and the community
 * tabs can never show diverging copies of a card.
 *
 * Deliberately owns no fetching and no subscription: each surface fetches its
 * own page, merges bus changes into it (applying them *and* deciding when a
 * refetch is needed) and passes the items in.
 */
export function CommunityFeedList({
  items,
  currentUserId,
  onChange,
  emptyState,
  showPastEvents = false,
  onOpenCommunityPreview,
}: CommunityFeedListProps) {
  const router = useGuardedRouter();
  const [editingShowcase, setEditingShowcase] = useState<FeedShowcase | null>(null);  const [deletingShowcase, setDeletingShowcase] = useState<FeedShowcase | null>(null);

  const updateItems = onChange;

  const openCommunity = useCallback(
    (communityId: string | null | undefined) => {
      if (!communityId) return;
      if (onOpenCommunityPreview) onOpenCommunityPreview(communityId);
      else router.push(`/dashboard/communities/${communityId}`);
    },
    [onOpenCommunityPreview, router],
  );

  // ── Card callbacks: patch locally, then announce ─────────────────────────

  const handleThreadUpdated = useCallback((updated: CommunityThread) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === updated.id ? { ...it, ...updated } : it
    ));
    publishContentChange({
      kind: "thread",
      id: updated.id,
      patch: updated as unknown as Record<string, unknown>,
    });
  }, [updateItems]);

  const handleThreadLikeChanged = useCallback((id: string, liked: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id
        ? { ...it, user_liked: liked, like_count: count }
        : it
    ));
    publishContentChange({ kind: "thread", id, patch: { user_liked: liked, like_count: count } });
  }, [updateItems]);

  const handleThreadSaveChanged = useCallback((id: string, saved: boolean) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id ? { ...it, user_saved: saved } : it
    ));
    publishContentChange({ kind: "thread", id, patch: { user_saved: saved } });
  }, [updateItems]);

  const handleThreadPollVoted = useCallback((id: string, counts: number[], userVote: number | null, undoUsed: boolean) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id
        ? { ...it, poll_vote_counts: counts, poll_user_vote: userVote, poll_undo_used: undoUsed }
        : it
    ));
    publishContentChange({
      kind: "thread",
      id,
      patch: { poll_vote_counts: counts, poll_user_vote: userVote, poll_undo_used: undoUsed },
    });
  }, [updateItems]);

  const handleThreadDeleted = useCallback((id: string) => {
    updateItems((prev) => prev.filter((it) => !(it._type === "thread" && it.id === id)));
    publishContentChange({ kind: "thread", id, removed: true });
  }, [updateItems]);

  const handleEventUpdated = useCallback((updated: CommunityEvent) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === updated.id ? { ...it, ...updated } : it
    ));
    publishContentChange({
      kind: "event",
      id: updated.id,
      patch: updated as unknown as Record<string, unknown>,
    });
  }, [updateItems]);

  const handleEventDeleted = useCallback((id: string) => {
    updateItems((prev) => prev.filter((it) => !(it._type === "event" && it.id === id)));
    publishContentChange({ kind: "event", id, removed: true });
  }, [updateItems]);

  const handleEventRsvpChanged = useCallback((id: string, rsvped: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_rsvped: rsvped, rsvp_count: count }
        : it
    ));
    publishContentChange({ kind: "event", id, patch: { user_rsvped: rsvped, rsvp_count: count } });
  }, [updateItems]);

  // The feeds have no realtime subscription, so the attendee avatar previews
  // must be refetched once an RSVP settles — otherwise the current user's avatar
  // never appears in the stack until the next full feed load.
  const handleEventRsvpSettled = useCallback(async (item: FeedEvent) => {
    if (!item.community_id) return;
    try {
      const response = await fetch(
        `/api/communities/${item.community_id}/events/${item.id}/rsvp/list`,
      );
      if (!response.ok) return;
      const data = await response.json() as { rsvps?: EventRsvp[] };
      updateItems((prev) => prev.map((it) =>
        it._type === "event" && it.id === item.id
          ? { ...it, rsvps: data.rsvps ?? [] }
          : it
      ));
    } catch {
      // Non-fatal — previews catch up on the next feed fetch.
    }
  }, [updateItems]);

  const handleEventLikeChanged = useCallback((id: string, liked: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_liked: liked, like_count: count }
        : it
    ));
    publishContentChange({ kind: "event", id, patch: { user_liked: liked, like_count: count } });
  }, [updateItems]);

  const handleEventSaveChanged = useCallback((id: string, saved: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_saved: saved, save_count: count }
        : it
    ));
    publishContentChange({ kind: "event", id, patch: { user_saved: saved, save_count: count } });
  }, [updateItems]);

  const handleResourceUpdated = useCallback((updated: CommunityResource) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === updated.id ? { ...it, ...updated } : it
    ));
    publishContentChange({
      kind: "resource",
      id: updated.id,
      patch: updated as unknown as Record<string, unknown>,
    });
  }, [updateItems]);

  const handleResourceSaveChanged = useCallback((id: string, saved: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === id ? { ...it, user_saved: saved } : it
    ));
    publishContentChange({ kind: "resource", id, patch: { user_saved: saved } });
  }, [updateItems]);

  const handleResourceBookmarkChanged = useCallback((id: string, bookmarked: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === id
        ? { ...it, user_bookmarked: bookmarked, bookmark_count: count }
        : it
    ));
    publishContentChange({
      kind: "resource",
      id,
      patch: { user_bookmarked: bookmarked, bookmark_count: count },
    });
  }, [updateItems]);

  const handleResourceDeleted = useCallback((id: string) => {
    updateItems((prev) => prev.filter((it) => !(it._type === "resource" && it.id === id)));
    publishContentChange({ kind: "resource", id, removed: true });
  }, [updateItems]);

  const handleShowcaseUpdated = useCallback((updated: ShowcasePost) => {
    setEditingShowcase(null);
    updateItems((prev) => prev.map((it) =>
      it._type === "showcase" && it.id === updated.id
        ? { ...it, ...updated, community_id: it.community_id, community_name: it.community_name, community_image: it.community_image }
        : it
    ));
    publishContentChange({
      kind: "showcase",
      id: updated.id,
      patch: updated as unknown as Record<string, unknown>,
    });
  }, [updateItems]);

  const handleShowcaseDeleted = useCallback(async (post: FeedShowcase) => {
    setDeletingShowcase(null);
    if (!post.community_id) return;
    const response = await fetch(`/api/communities/${post.community_id}/showcase/${post.id}`, { method: "DELETE" });
    if (response.ok) {
      updateItems((prev) => prev.filter((it) => !(it._type === "showcase" && it.id === post.id)));
      publishContentChange({ kind: "showcase", id: post.id, removed: true });
    }
  }, [updateItems]);

  // ── Render ────────────────────────────────────────────────────────────────

  const now = new Date();
  const visibleItems = showPastEvents
    ? items
    : items.filter((item) =>
        item._type !== "event" || new Date(item.end_date ?? item.event_date) >= now,
      );

  if (!visibleItems.length) {
    return <>{emptyState ?? null}</>;
  }

  // Group consecutive resources together while keeping threads, events, and
  // showcase posts full-width in the feed.
  type Group =
    | { kind: "thread"; item: Extract<FeedItem, { _type: "thread" }> }
    | { kind: "event"; item: FeedEvent }
    | { kind: "showcase"; item: FeedShowcase }
    | { kind: "resources"; items: FeedResource[] };

  const groups: Group[] = [];
  for (const item of visibleItems) {
    if (item._type === "resource") {
      const last = groups[groups.length - 1];
      if (last?.kind === "resources") last.items.push(item);
      else groups.push({ kind: "resources", items: [item] });
    } else if (item._type === "thread") {
      groups.push({ kind: "thread", item });
    } else if (item._type === "event") {
      groups.push({ kind: "event", item });
    } else {
      groups.push({ kind: "showcase", item });
    }
  }

  return (
    <>
      <ul className="flex flex-col gap-4">
        {groups.map((group) => {
          if (group.kind === "thread") {
            return (
              <li key={`thread-${group.item.id}`} className={feedCardWrapperClassName}>
                <ThreadCard
                  thread={{ ...group.item, community_id: group.item.community_id ?? "" }}
                  currentUserId={currentUserId}
                  communityId={group.item.community_id ?? ""}
                  communityName={group.item.community_name ?? undefined}
                  communityImage={group.item.community_image}
                  communityNamePlacement="below"
                  onUpdated={handleThreadUpdated}
                  onLikeChanged={handleThreadLikeChanged}
                  onSaveChanged={handleThreadSaveChanged}
                  onPollVoteChanged={handleThreadPollVoted}
                  onDeleted={handleThreadDeleted}
                  onOpen={() => router.push(`/dashboard/threads/${group.item.id}`)}
                  onCommunityClick={() => openCommunity(group.item.community_id)}
                />
              </li>
            );
          }

          if (group.kind === "event") {
            return (
              <li key={`event-${group.item.id}`} className={feedCardWrapperClassName}>
                <EventCard
                  event={{ ...group.item, community_id: group.item.community_id ?? "" }}
                  rsvps={group.item.rsvps}
                  currentUserId={currentUserId}
                  communityId={group.item.community_id ?? ""}
                  communityName={group.item.community_name ?? undefined}
                  communityImage={group.item.community_image}
                  onOpen={() => router.push(`/dashboard/events/${group.item.id}`)}
                  onUpdated={handleEventUpdated}
                  onDeleted={handleEventDeleted}
                  onRsvpChanged={handleEventRsvpChanged}
                  onRsvpSettled={() => handleEventRsvpSettled(group.item)}
                  onLikeChanged={handleEventLikeChanged}
                  onSaveChanged={handleEventSaveChanged}
                  onCommunityClick={() => openCommunity(group.item.community_id)}
                />
              </li>
            );
          }

          if (group.kind === "showcase") {
            return (
              <li key={`showcase-${group.item.id}`} className={feedCardWrapperClassName}>
                <ShowcaseCard
                  post={{ ...group.item, community_id: group.item.community_id ?? "" }}
                  currentUserId={currentUserId}
                  isLast
                  communityId={group.item.community_id ?? ""}
                  communityName={group.item.community_name ?? undefined}
                  communityImage={group.item.community_image}
                  onOpen={() => router.push(`/dashboard/showcase/${group.item.id}`)}
                  onLikeChanged={(liked, count) => {
                    updateItems((prev) => prev.map((item) =>
                      item._type === "showcase" && item.id === group.item.id
                        ? { ...item, user_liked: liked, like_count: count }
                        : item
                    ));
                    publishContentChange({
                      kind: "showcase",
                      id: group.item.id,
                      patch: { user_liked: liked, like_count: count },
                    });
                  }}
                  onSaveChanged={(saved) => {
                    updateItems((prev) => prev.map((item) =>
                      item._type === "showcase" && item.id === group.item.id
                        ? { ...item, user_saved: saved }
                        : item
                    ));
                    publishContentChange({
                      kind: "showcase",
                      id: group.item.id,
                      patch: { user_saved: saved },
                    });
                  }}
                  onEdit={() => setEditingShowcase(group.item)}
                  onDelete={() => setDeletingShowcase(group.item)}
                  onCommunityClick={() => openCommunity(group.item.community_id)}
                />
              </li>
            );
          }

          return group.items.map((resource) => (
            <li
              key={`resource-${resource.id}`}
              className={feedCardWrapperClassName}
            >
              <ResourceCard
                resource={{ ...resource, community_id: resource.community_id ?? "" }}
                currentUserId={currentUserId}
                communityId={resource.community_id ?? ""}
                communityName={resource.community_name ?? undefined}
                communityImage={resource.community_image}
                onUpdated={handleResourceUpdated}
                onSaveChanged={handleResourceSaveChanged}
                onBookmarkChanged={handleResourceBookmarkChanged}
                onDeleted={handleResourceDeleted}
                onOpen={() => router.push(`/dashboard/resources/${resource.id}`)}
                onCommunityClick={() => openCommunity(resource.community_id)}
              />
            </li>
          ));
        })}
      </ul>

      {editingShowcase && editingShowcase.community_id && (
        <CreateShowcaseModal
          communityId={editingShowcase.community_id}
          initialIsPublic={editingShowcase.is_public}
          post={editingShowcase as ShowcasePost}
          onClose={() => setEditingShowcase(null)}
          onUpdated={handleShowcaseUpdated}
        />
      )}

      <ConfirmDialog
        open={!!deletingShowcase}
        title="Delete showcase post?"
        message="This will permanently remove this showcase post. This cannot be undone."
        onClose={() => setDeletingShowcase(null)}
        onConfirm={() => {
          if (deletingShowcase) return handleShowcaseDeleted(deletingShowcase);
        }}
      />
    </>
  );
}
