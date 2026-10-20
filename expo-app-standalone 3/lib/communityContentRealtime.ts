/**
 * Targeted updates for community content realtime events.
 *
 * The chat-adjacent tabs used to invalidate and refetch the whole list for
 * every like, save, poll vote and RSVP. Those payloads carry enough information
 * to patch the visible row, so the hook applies them locally and only falls
 * back to a (debounced, single-flight) refetch when a payload is incomplete or
 * the event changes the list's membership (create/update/delete).
 *
 * Pure and React-free so the rule can be tested without the native runtime.
 */

import type {
  CommunityEvent,
  CommunityResource,
  CommunityThread,
  ContentByKind,
  ContentKind,
} from "./communityContent";

type JsonRecord = Record<string, unknown>;

export interface ContentRealtimeUpdate<K extends ContentKind> {
  /** True when the event was understood; false means "revalidate safely". */
  handled: boolean;
  /** True when a row actually changed (handled can be true with no change). */
  changed: boolean;
  items: ContentByKind[K][];
}

/**
 * The hook's refetch decision. A complete interaction patch returns false, so
 * one like/save/poll/RSVP cannot cause a full-list request.
 */
export function needsContentRevalidation(
  update: Pick<ContentRealtimeUpdate<ContentKind>, "handled">,
): boolean {
  return !update.handled;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInsertOrDelete(value: unknown): value is "INSERT" | "DELETE" {
  return value === "INSERT" || value === "DELETE";
}

function applyDelta(count: unknown, event: "INSERT" | "DELETE"): number {
  const current = typeof count === "number" && Number.isFinite(count) ? count : 0;
  return Math.max(0, current + (event === "INSERT" ? 1 : -1));
}

function unchanged<K extends ContentKind>(
  items: ContentByKind[K][],
): ContentRealtimeUpdate<K> {
  return { handled: true, changed: false, items };
}

function fallback<K extends ContentKind>(
  items: ContentByKind[K][],
): ContentRealtimeUpdate<K> {
  return { handled: false, changed: false, items };
}

function patchThreadLike(
  items: CommunityThread[],
  data: JsonRecord,
  currentUserId: string,
): ContentRealtimeUpdate<"threads"> {
  if (!isInsertOrDelete(data.event) || typeof data.thread_id !== "string") {
    return fallback(items);
  }
  const event = data.event;
  // The sender's own mutation response already carries the authoritative
  // count; adding the echo would double-count it (web parity).
  if (data.user_id === currentUserId) return unchanged(items);

  let changed = false;
  const next = items.map((thread) => {
    if (thread.id !== data.thread_id) return thread;
    changed = true;
    return {
      ...thread,
      like_count: applyDelta(thread.like_count, event),
    };
  });
  return { handled: true, changed, items: next };
}

function patchThreadPoll(
  items: CommunityThread[],
  data: JsonRecord,
  currentUserId: string,
): ContentRealtimeUpdate<"threads"> {
  if (
    typeof data.thread_id !== "string" ||
    !Array.isArray(data.counts) ||
    data.counts.length === 0 ||
    !data.counts.every((count) => typeof count === "number" && Number.isFinite(count))
  ) {
    return fallback(items);
  }
  const counts = data.counts as number[];
  const isMine = data.user_id === currentUserId;

  let changed = false;
  const next = items.map((thread) => {
    if (thread.id !== data.thread_id) return thread;
    changed = true;
    return {
      ...thread,
      poll_vote_counts: counts,
      ...(isMine
        ? {
            poll_user_vote:
              typeof data.user_vote === "number" ? data.user_vote : null,
            poll_undo_used: data.undo_used === true,
          }
        : {}),
    };
  });
  return { handled: true, changed, items: next };
}

function patchEventCount(
  items: CommunityEvent[],
  data: JsonRecord,
  field: "like_count" | "save_count" | "rsvp_count",
  currentUserId: string,
): ContentRealtimeUpdate<"events"> {
  if (!isInsertOrDelete(data.event) || typeof data.event_id !== "string") {
    return fallback(items);
  }
  const change = data.event;
  if (data.user_id === currentUserId) return unchanged(items);

  let changed = false;
  const next = items.map((event) => {
    if (event.id !== data.event_id) return event;
    changed = true;
    return {
      ...event,
      [field]: applyDelta(event[field], change),
    };
  });
  return { handled: true, changed, items: next };
}

function patchResourceSave(
  items: CommunityResource[],
  data: JsonRecord,
  currentUserId: string,
): ContentRealtimeUpdate<"resources"> {
  if (!isInsertOrDelete(data.event) || typeof data.resource_id !== "string") {
    return fallback(items);
  }
  const event = data.event;
  if (data.user_id === currentUserId) return unchanged(items);

  let changed = false;
  const next = items.map((resource) => {
    if (resource.id !== data.resource_id) return resource;
    changed = true;
    return {
      ...resource,
      save_count: applyDelta(resource.save_count, event),
    };
  });
  return { handled: true, changed, items: next };
}

/**
 * Apply one realtime event to the visible list.
 *
 * `handled: false` is the safe revalidation signal: the caller must refresh
 * (through its debounced scheduler) rather than guess. Structural events and
 * payloads from an older server that lack the insert/delete marker land here.
 */
export function applyContentRealtimeEvent<K extends ContentKind>(
  kind: K,
  items: ContentByKind[K][],
  topic: string,
  raw: unknown,
  currentUserId: string,
): ContentRealtimeUpdate<K> {
  if (!isRecord(raw)) return fallback(items);

  if (kind === "threads") {
    if (topic === "like") {
      return patchThreadLike(items as CommunityThread[], raw, currentUserId) as ContentRealtimeUpdate<K>;
    }
    if (topic === "poll") {
      return patchThreadPoll(items as CommunityThread[], raw, currentUserId) as ContentRealtimeUpdate<K>;
    }
    return fallback(items);
  }

  if (kind === "events") {
    if (topic === "like") {
      return patchEventCount(
        items as CommunityEvent[],
        raw,
        "like_count",
        currentUserId,
      ) as ContentRealtimeUpdate<K>;
    }
    if (topic === "save") {
      return patchEventCount(
        items as CommunityEvent[],
        raw,
        "save_count",
        currentUserId,
      ) as ContentRealtimeUpdate<K>;
    }
    if (topic === "rsvp") {
      return patchEventCount(
        items as CommunityEvent[],
        raw,
        "rsvp_count",
        currentUserId,
      ) as ContentRealtimeUpdate<K>;
    }
    return fallback(items);
  }

  if (kind === "resources") {
    if (topic === "save") {
      return patchResourceSave(items as CommunityResource[], raw, currentUserId) as ContentRealtimeUpdate<K>;
    }
    return fallback(items);
  }

  // Showcase has no realtime room today.
  return fallback(items);
}
