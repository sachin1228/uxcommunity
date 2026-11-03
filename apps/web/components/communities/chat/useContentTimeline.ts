"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTENT_EVENT_CHANGED_EVENT,
  type CachedContentEvent,
  type CachedMeta,
  type CachedThreadEvent,
  type MessageReaction,
} from "@/lib/communities/cache";
import { fetchAndHydrateCommunityContentEvents, initRequestCache } from "@/lib/request-cache";
import type { CommunityThread } from "@/lib/communities/models/threads";
import { mergeContentEventSnapshot } from "@/lib/communities/content-event-snapshot";

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
 * Cards for threads AND the other three areas. Loaded after the chat snapshot
 * (history) and kept current by the chat room's content-insert / content-delete
 * realtime topics — so a card lives as long as the chat window shows it, not a
 * session-only bubble. They are notifications: the server hands back only the
 * cards created after this member joined (and inside the 15-day window), while
 * the thread/post/resource/event itself keeps its own page.
 */
export function useContentTimeline({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const [threadEvents, setThreadEvents] = useState<CachedThreadEvent[]>([]);
  const [contentEvents, setContentEvents] = useState<CachedContentEvent[]>([]);
  const deletedContentIds = useRef(new Set<string>());
  const handleContentDeleted = useCallback((id: string) => {
    // History can have been read just before this delete. Keep its tombstone
    // even if the card has not arrived in local state yet.
    deletedContentIds.current.add(id);
    setContentEvents((prev) => prev.filter((event) => event.id !== id));
  }, []);

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
    handleContentDeleted(threadId);
  }, [handleContentDeleted]);

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
    deletedContentIds.current.clear();
    queueMicrotask(() => {
      if (!cancelled) {
        setThreadEvents([]);
        setContentEvents([]);
      }
    });
    initRequestCache(currentUserId);

    // The helper shares the critical bootstrap, then loads only timeline
    // history. Message readiness never waits for these secondary reads.
    void fetchAndHydrateCommunityContentEvents(communityId, currentUserId)
      .then((section) => {
        if (cancelled) return;
        setContentEvents((current) => mergeContentEventSnapshot(
          (section.events ?? []) as CachedContentEvent[], current, deletedContentIds.current,
        ));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [communityId, currentUserId]);

  return {
    threadEvents,
    setThreadEvents,
    contentEvents,
    setContentEvents,
    handleThreadCreated,
    handleThreadDeleted,
    handleContentDeleted,
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
  onDeleteContentEvent,
}: {
  communityId: string;
  currentUserId: string;
  members: CachedMeta["members"];
  setContentEvents: React.Dispatch<React.SetStateAction<CachedContentEvent[]>>;
  onDeleteContentEvent: (id: string) => void;
}) {
  useEffect(() => {
    const onContentEvent = (change: Event) => {
      const detail = (change as CustomEvent<ContentEventChange>).detail;
      if (!detail || detail.event.community_id !== communityId) return;
      if (detail.kind === "delete") {
        onDeleteContentEvent(detail.event.id);
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
  }, [communityId, currentUserId, members, setContentEvents, onDeleteContentEvent]);
}
