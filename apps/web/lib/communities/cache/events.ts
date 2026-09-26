import type { ContentEventKind } from "./types";
import type { ContentEventMeta } from "../content-notifications";

export const SIDEBAR_CHANGED_EVENT = "uxcommunity:sidebar-changed";
/**
 * Fired only for local reaction preview patches. Unlike SIDEBAR_CHANGED_EVENT
 * this must NOT trigger a server refetch: the cached /api/communities snapshot
 * predates the reaction, and reloading it would clobber the optimistic preview
 * (and any newer last_message) with stale rows.
 */
export const SIDEBAR_REACTION_CHANGED_EVENT = "uxcommunity:sidebar-reaction-changed";
/**
 * Fired only for local last-message patches (optimistic sends from the chat
 * window). Same constraints as SIDEBAR_REACTION_CHANGED_EVENT: no server
 * refetch, because the cached /api/communities snapshot predates the send.
 */
export const SIDEBAR_MESSAGE_CHANGED_EVENT = "uxcommunity:sidebar-message-changed";

export function notifySidebarChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_CHANGED_EVENT));
  }
}

export function notifySidebarReactionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_REACTION_CHANGED_EVENT));
  }
}

export function notifySidebarMessageChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_MESSAGE_CHANGED_EVENT));
  }
}

// ─── Content-event mirrors (timeline ↔ tabs) ───────────────────────────────

export const CONTENT_EVENT_CHANGED_EVENT = "uxcommunity:content-event-changed";

/**
 * Fired when the current user creates or deletes a thread/showcase post/
 * resource/event so the mounted chat timeline can add or remove its permanent
 * "You created a …" card in the same frame. Payload mirrors the realtime
 * `content-insert` / `content-delete` topics, so the timeline treats both
 * paths identically (idempotent by item id).
 */
export function notifyContentEvent(
  detail:
    | { kind: "insert"; event: { id: string; community_id: string; user_id: string; kind: ContentEventKind; title: string; created_at: string; meta?: ContentEventMeta | null } }
    | { kind: "delete"; event: { id: string; community_id: string; kind: ContentEventKind } },
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONTENT_EVENT_CHANGED_EVENT, { detail }));
}
