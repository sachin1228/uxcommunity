"use client";

/**
 * The one place that drops the previous member's state from the browser when
 * the session changes.
 *
 * Everything the signed-in app reads is held in module-level caches so an SPA
 * navigation can paint instantly — the request cache (`lib/request-cache`), the
 * community / sidebar / explore stores (`lib/communities/cache`), the read
 * manager, the content-change bus, the request-replay buffers in
 * `lib/dedupe-fetch`, and the shared `/api/auth/me` memo. Those caches survive
 * a client-side navigation, so a session boundary has to clear them explicitly;
 * relying on their per-user guards is not enough, because a guard only fires
 * the *next* time a component happens to read a user id, and any read that
 * happens first is served the previous member's data.
 *
 * Called from `useLogout` and from the login page — see also the hard
 * navigation at both boundaries, which is what drops Next's own client Router
 * Cache (it is keyed by URL and never sees the session cookie).
 */

import { clearAllUserCaches } from "@/lib/communities/cache";
import { clearContentChanges } from "@/lib/communities/content-sync";
import { resetReadManager } from "@/lib/communities/read-manager";
import { clearDedupeCache } from "@/lib/dedupe-fetch";
import { resetCurrentUserSummary } from "@/lib/current-user";
import { clearRequestCache } from "@/lib/request-cache";

export function resetClientSessionCaches(): void {
  // Community, sidebar and explore stores + the chat message/metadata caches.
  clearAllUserCaches();
  // Fetched `/api/*` payloads, their in-flight promises and subscribers.
  clearRequestCache();
  // Debounced/retrying mark-read decisions and the unread counts they track.
  resetReadManager();
  // Card mutations queued for lists that were unmounted when they happened.
  clearContentChanges();
  // Recently settled request replays (a new session must hit the network).
  clearDedupeCache();
  // The shared `/api/auth/me` identity memo used by every comment composer.
  resetCurrentUserSummary();
}
