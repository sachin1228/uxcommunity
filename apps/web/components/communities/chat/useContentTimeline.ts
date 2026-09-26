"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CONTENT_EVENT_CHANGED_EVENT,
  metaCache,
  msgCache,
  msgFetchedAt,
  type CachedContentEvent,
  type CachedMessage,
  type CachedMeta,
  type CachedThreadEvent,
  type MessageReaction,
} from "@/lib/communities/cache";
import { fetchAndHydrateCommunityBootstrap, initRequestCache } from "@/lib/request-cache";
import type { CommunityThread } from "@/lib/communities/models/threads";

type ContentReactionRow = { content_id: string; kind: string; reactions: MessageReaction[] };

function byCreatedAt(a: { created_at: string }, b: { created_at: string }) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function sameReactions(current: MessageReaction[], next: MessageReaction[]) {
  // Compare the reactors too, not just the emoji: the same emoji gaining
  // another member changes the pill's count.
  return (
    current.length === next.length &&
    current.every(
      (r, i) =>
        r.emoji === next[i].emoji &&
        r.user_ids.length === next[i].user_ids.length &&
        r.user_ids.every((id, j) => id === next[i].user_ids[j]),
    )
  );
}

/**
 * The "John created a …" cards interleaved with chat messages.
 *
 * Permanent cards for threads AND the other three areas. Seeded from
 * /bootstrap (history) and kept current by the chat room's content-insert /
 * content-delete realtime topics — so a card is as permanent as a message, not
 * a session-only bubble. This hook also primes the community meta/message
 * caches, because the same bootstrap request carries both.
 */
export function useContentTimeline({
  communityId,
  currentUserId,
  initialMeta,
  initialMessages,
}: {
  communityId: string;
  currentUserId: string;
  initialMeta?: CachedMeta;
  initialMessages?: CachedMessage[];
}) {
  const [threadEvents, setThreadEvents] = useState<CachedThreadEvent[]>([]);
  const [contentEvents, setContentEvents] = useState<CachedContentEvent[]>([]);
  /** True once the initial threads fetch for the current community has settled. */
  const [threadsReady, setThreadsReady] = useState(false);
  /** True once the content-events history (bootstrap section) has settled. */
  const [contentEventsReady, setContentEventsReady] = useState(false);

  const handleThreadCreated = useCallback((thread: CommunityThread) => {
    setThreadEvents((prev) => {
      if (prev.some((event) => event.id === thread.id)) return prev;
      const event: CachedThreadEvent = {
        id: thread.id,
        community_id: thread.community_id,
        user_id: thread.user_id,
        title: thread.title,
        category: thread.category,
        attachments: thread.attachments ?? [],
        created_at: thread.created_at,
        users: thread.users,
      };
      return [...prev, event].sort(byCreatedAt);
    });
  }, []);

  // Symmetric with handleThreadCreated: when the creator deletes a thread from
  // the Threads tab, its "created a new thread" bubble must disappear from chat
  // immediately rather than lingering until (or forever without) the realtime
  // thread-delete echo.
  const handleThreadDeleted = useCallback((threadId: string) => {
    setThreadEvents((prev) => prev.filter((event) => event.id !== threadId));
    // The unified content-event card is the one the timeline renders now.
    setContentEvents((prev) => prev.filter((event) => event.id !== threadId));
  }, []);

  // Reaction groups that arrive with each message page (the RPC attaches them
  // for the timeline's notification cards) are folded into the content events.
  const mergeContentReactions = useCallback((rows: ContentReactionRow[]) => {
    setContentEvents((prev) => {
      const byId = new Map(rows.map((row) => [row.content_id, row.reactions]));
      let changed = false;
      const next = prev.map((event) => {
        const reactions = byId.get(event.id);
        if (!reactions || sameReactions(event.reactions ?? [], reactions)) return event;
        changed = true;
        return { ...event, reactions };
      });
      return changed ? next : prev;
    });
  }, []);

  const applyContentReactions = useCallback((contentId: string, reactions: MessageReaction[]) => {
    setContentEvents((prev) => {
      let changed = false;
      const next = prev.map((event) => {
        if (event.id !== contentId) return event;
        changed = true;
        return { ...event, reactions };
      });
      // Keep the previous array when the card isn't in the loaded window (or
      // already carries this state) so nothing re-renders needlessly.
      return changed ? next : prev;
    });
  }, []);

  // Prime only first-render data. Secondary tabs fetch from their own cached
  // endpoints when mounted, so their work cannot delay the chat shell.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setThreadEvents([]);
        setThreadsReady(false);
        setContentEvents([]);
        setContentEventsReady(false);
      }
    });
    initRequestCache(currentUserId);

    // A server-rendered snapshot is authoritative for this navigation. Seed
    // the shared client caches and avoid immediately requesting the same page
    // data again after hydration.
    if (initialMeta && initialMessages) {
      const fetchedAt = Date.now();
      metaCache.set(communityId, { ...initialMeta, fetchedAt });
      msgCache.set(communityId, initialMessages);
      msgFetchedAt.set(communityId, fetchedAt);
      queueMicrotask(() => {
        if (!cancelled) {
          setThreadsReady(true);
          setContentEventsReady(true);
        }
      });
      return () => { cancelled = true; };
    }

    void fetchAndHydrateCommunityBootstrap(communityId, currentUserId)
      .then((data) => {
        if (cancelled) return;
        const communityData = data.community as {
          community: CachedMeta["community"];
          members: CachedMeta["members"];
        };
        const messageData = data.messages as { messages: CachedMessage[] };
        const contentData = data["content-events"] as { events?: CachedContentEvent[] } | undefined;
        const fetchedAt = Date.now();

        metaCache.set(communityId, {
          community: communityData.community,
          members: communityData.members,
          fetchedAt,
        });
        msgCache.set(communityId, messageData.messages ?? []);
        msgFetchedAt.set(communityId, fetchedAt);
        if (contentData) setContentEvents(contentData.events ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setThreadsReady(true);
          setContentEventsReady(true);
        }
      });

    return () => { cancelled = true; };
  }, [communityId, currentUserId, initialMessages, initialMeta]);

  return {
    threadEvents,
    setThreadEvents,
    contentEvents,
    setContentEvents,
    threadsReady,
    contentEventsReady,
    handleThreadCreated,
    handleThreadDeleted,
    mergeContentReactions,
    applyContentReactions,
  };
}

type ContentEventChange = {
  kind: "insert" | "delete";
  event: {
    id: string;
    community_id: string;
    user_id?: string;
    kind: CachedContentEvent["kind"];
    title?: string;
    created_at?: string;
    meta?: CachedContentEvent["meta"];
  };
};

/**
 * Local creates/deletes from the mounted tabs (Threads/Showcase/Resources/
 * Events) mirror into the timeline instantly — the server broadcast arrives
 * later via realtime and dedupes by id.
 */
export function useLocalContentEventMirror({
  communityId,
  currentUserId,
  members,
  setContentEvents,
}: {
  communityId: string;
  currentUserId: string;
  members: CachedMeta["members"];
  setContentEvents: React.Dispatch<React.SetStateAction<CachedContentEvent[]>>;
}) {
  useEffect(() => {
    const onContentEvent = (change: Event) => {
      const detail = (change as CustomEvent<ContentEventChange>).detail;
      if (!detail || detail.event.community_id !== communityId) return;
      if (detail.kind === "delete") {
        setContentEvents((prev) => prev.filter((event) => event.id !== detail.event.id));
        return;
      }
      const row = detail.event;
      setContentEvents((prev) => {
        if (prev.some((event) => event.id === row.id)) return prev;
        const member = members.find((m) => m.user_id === row.user_id);
        const next: CachedContentEvent = {
          id: row.id,
          community_id: row.community_id,
          user_id: row.user_id ?? currentUserId,
          kind: row.kind,
          title: row.title ?? "",
          created_at: row.created_at ?? new Date().toISOString(),
          meta: row.meta ?? null,
          users: member?.users ?? null,
        };
        return [...prev, next].sort(byCreatedAt);
      });
    };
    window.addEventListener(CONTENT_EVENT_CHANGED_EVENT, onContentEvent);
    return () => window.removeEventListener(CONTENT_EVENT_CHANGED_EVENT, onContentEvent);
  }, [communityId, currentUserId, members, setContentEvents]);
}
