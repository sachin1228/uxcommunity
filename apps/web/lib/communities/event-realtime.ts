/**
 * Targeted patches for the Events tab's realtime topics.
 *
 * A like, RSVP or save event carries enough information to update the visible
 * card. Structural `event` events still revalidate, because a create/update can
 * change ordering, pagination and the enriched attendee/chat fields.
 *
 * Pure so the "one interaction must not force-fetch both pages" rule can be
 * tested without a browser.
 */

import type { CommunityEvent } from "./models/events";

type JsonRecord = Record<string, unknown>;

export interface EventRealtimeUpdate {
  /** False means the caller must revalidate instead of guessing. */
  handled: boolean;
  changed: boolean;
  items: CommunityEvent[];
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isDelta(value: unknown): value is "INSERT" | "DELETE" {
  return value === "INSERT" || value === "DELETE";
}

function delta(count: number, event: "INSERT" | "DELETE"): number {
  return Math.max(0, count + (event === "INSERT" ? 1 : -1));
}

function unchanged(items: CommunityEvent[]): EventRealtimeUpdate {
  return { handled: true, changed: false, items };
}

function fallback(items: CommunityEvent[]): EventRealtimeUpdate {
  return { handled: false, changed: false, items };
}

/**
 * Apply a realtime event to the visible event list.
 *
 * `handled: false` is the safe revalidation signal. It covers structural
 * events and older like/save payloads that lack the INSERT/DELETE marker.
 */
export function applyEventRealtimeEvent(
  items: CommunityEvent[],
  topic: string,
  raw: unknown,
  currentUserId: string,
): EventRealtimeUpdate {
  if (!isRecord(raw)) return fallback(items);

  const field =
    topic === "like"
      ? ("like_count" as const)
      : topic === "save"
        ? ("save_count" as const)
        : topic === "rsvp"
          ? ("rsvp_count" as const)
          : null;

  if (!field) return fallback(items);
  if (!isDelta(raw.event) || typeof raw.event_id !== "string") return fallback(items);

  // The local mutation response already applied the authoritative state; the
  // echo would double-count the actor's own click.
  if (raw.user_id === currentUserId) return unchanged(items);

  let changed = false;
  const next = items.map((event) => {
    if (event.id !== raw.event_id) return event;
    changed = true;
    return { ...event, [field]: delta(event[field], raw.event as "INSERT" | "DELETE") };
  });
  return { handled: true, changed, items: next };
}
