/**
 * One shared read of the community bootstrap — the mobile counterpart of the
 * web client's fetchAndHydrateCommunityBootstrap.
 *
 * WHY THIS EXISTS
 *   The chat needs messages AND the "created a …" content-event window at
 *   open. Fetching them separately meant two requests — and worse, a second
 *   full bootstrap (the heaviest endpoint: messages RPC + four content lists +
 *   community + rules) just for the content events. This module makes opening
 *   a chat cost exactly one request, shared by both hooks, with the web's own
 *   dedupe + staleness semantics:
 *
 *     • in-flight requests are shared (a hook pair mounting together issues
 *       one fetch);
 *     • a settled response stays fresh for COMMUNITY_BOOTSTRAP_STALE_MS —
 *       re-entering the chat inside the window issues NO request at all. The
 *       messages hook's cursor catch-up (?after) is what keeps the window
 *       correct in between, exactly like web; realtime keeps it live, and
 *       patchCachedBootstrapMessages below keeps the CACHED window itself
 *       current while the chat is open.
 *
 *   Freshness matters to the server, not just the phone: every avoided
 *   refetch is a Worker invocation that is no longer paying for the four
 *   content-list queries the bootstrap fans out to.
 */

import { apiFetch } from './api';
import type { Message } from './communities';
import type { ChatContentEvent } from './chatContentEvents';

/** Same staleness window the web client gives its bootstrap (lib/request-cache.ts). */
export const COMMUNITY_BOOTSTRAP_STALE_MS = 15 * 60_000;

interface CommunityBootstrapResponse {
  messages?: { messages?: Message[] };
  'content-events'?: { events?: ChatContentEvent[] };
}

export interface CommunityBootstrap {
  messages: Message[];
  contentEvents: ChatContentEvent[];
}

const cache = new Map<string, { fetchedAt: number; data: CommunityBootstrap }>();
const inflight = new Map<string, Promise<CommunityBootstrap>>();

/**
 * The bootstrapped sections, deduped across concurrent callers and reused
 * while fresh. Rejections are never cached — the next open retries. An EMPTY
 * message window is never reused either: with no newest message there is no
 * catch-up cursor, so serving it from cache after a socket gap would leave
 * the room looking blank.
 */
export function fetchCommunityBootstrap(communityId: string): Promise<CommunityBootstrap> {
  const cached = cache.get(communityId);
  if (
    cached &&
    cached.data.messages.length > 0 &&
    Date.now() - cached.fetchedAt < COMMUNITY_BOOTSTRAP_STALE_MS
  ) {
    return Promise.resolve(cached.data);
  }

  const pending = inflight.get(communityId);
  if (pending) return pending;

  const request = apiFetch<CommunityBootstrapResponse>(
    `/api/communities/${communityId}/bootstrap`
  )
    .then(({ data }) => {
      const normalized: CommunityBootstrap = {
        messages: data.messages?.messages ?? [],
        contentEvents: data['content-events']?.events ?? [],
      };
      cache.set(communityId, { fetchedAt: Date.now(), data: normalized });
      return normalized;
    })
    .finally(() => {
      inflight.delete(communityId);
    });

  inflight.set(communityId, request);
  return request;
}

/**
 * Fold the open chat's newest window back into the cached bootstrap entry.
 *
 * WHY THIS EXISTS
 *   A settled bootstrap response is reused for 15 minutes, and on a phone the
 *   cache entry is the ONLY message store that survives leaving the chat —
 *   the hook's state dies with its screen. Without this, re-entering inside
 *   the window re-rendered the fetch-time snapshot, so every message that
 *   arrived after that fetch (the user's own sends included) vanished until
 *   the next socket reconnect happened to run a catch-up. That is exactly the
 *   bug chat re-entry kept showing: "I sent it, it's on the web, it's gone
 *   from the phone".
 *
 *   The messages hook writes its current window here on every change (real
 *   rows only — a persisted "sending" bubble could never resolve), so the
 *   next open inside the window paints the rows the user just saw, and the
 *   mount catch-up only has to cover what arrived while the chat was closed.
 *
 *   Only existing entries are patched: the other sections stay tied to their
 *   own fetch, the freshness clock is deliberately NOT extended (this is the
 *   same entry, only its message window is newer), and an unknown community
 *   must not gain a messages-only entry that pretends its content events were
 *   fetched.
 */
export function patchCachedBootstrapMessages(
  communityId: string,
  messages: Message[],
): void {
  const cached = cache.get(communityId);
  if (!cached) return;
  cache.set(communityId, {
    fetchedAt: cached.fetchedAt,
    data: { ...cached.data, messages },
  });
}
