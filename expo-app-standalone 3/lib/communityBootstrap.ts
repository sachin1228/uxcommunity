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
 *       re-entering the chat inside the window issues NO bootstrap request.
 *       Cursor catch-up keeps the message window correct in between, while
 *       realtime and the bounded hot window cache keep it current in-app.
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
export const MAX_COMMUNITY_BOOTSTRAP_ENTRIES = 40;
export const COMMUNITY_BOOTSTRAP_MESSAGE_LIMIT = 120;
export const COMMUNITY_BOOTSTRAP_EVENT_LIMIT = 60;

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
const eventCache = new Map<string, { fetchedAt: number; data: ChatContentEvent[] }>();
const eventInflight = new Map<string, Promise<ChatContentEvent[]>>();
const messageWindowCache = new Map<string, { fetchedAt: number; data: Message[] }>();

function bootstrapKey(communityId: string, userId: string): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(communityId)}`;
}

function rememberBootstrap(
  key: string,
  value: { fetchedAt: number; data: CommunityBootstrap },
): void {
  cache.delete(key);
  cache.set(key, {
    fetchedAt: value.fetchedAt,
    data: {
      messages: value.data.messages.slice(-COMMUNITY_BOOTSTRAP_MESSAGE_LIMIT),
      contentEvents: value.data.contentEvents.slice(-COMMUNITY_BOOTSTRAP_EVENT_LIMIT),
    },
  });
  while (cache.size > MAX_COMMUNITY_BOOTSTRAP_ENTRIES) {
    cache.delete(cache.keys().next().value!);
  }
}

function rememberEvents(key: string, value: { fetchedAt: number; data: ChatContentEvent[] }): void {
  eventCache.delete(key);
  eventCache.set(key, {
    fetchedAt: value.fetchedAt,
    data: value.data.slice(-COMMUNITY_BOOTSTRAP_EVENT_LIMIT),
  });
  while (eventCache.size > MAX_COMMUNITY_BOOTSTRAP_ENTRIES) {
    eventCache.delete(eventCache.keys().next().value!);
  }
}

function rememberMessageWindow(key: string, value: { fetchedAt: number; data: Message[] }): void {
  messageWindowCache.delete(key);
  messageWindowCache.set(key, value);
  while (messageWindowCache.size > MAX_COMMUNITY_BOOTSTRAP_ENTRIES) {
    messageWindowCache.delete(messageWindowCache.keys().next().value!);
  }
}

/**
 * The bootstrapped sections, deduped across concurrent callers and reused
 * while fresh. Rejections are never cached — the next open retries. An EMPTY
 * message window is never reused either: with no newest message there is no
 * catch-up cursor, so serving it from cache after a socket gap would leave
 * the room looking blank.
 */
export function fetchCommunityBootstrap(
  communityId: string,
  userId = 'anonymous',
): Promise<CommunityBootstrap> {
  const key = bootstrapKey(communityId, userId);
  const cached = getCachedCommunityBootstrap(communityId, userId);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = apiFetch<CommunityBootstrapResponse>(
    `/api/communities/${communityId}/bootstrap`
  )
    .then(({ data }) => {
      const normalized: CommunityBootstrap = {
        messages: data.messages?.messages ?? [],
        contentEvents: data['content-events']?.events ?? [],
      };
      const fetchedAt = Date.now();
      rememberBootstrap(key, { fetchedAt, data: normalized });
      rememberEvents(key, { fetchedAt, data: normalized.contentEvents });
      rememberMessageWindow(key, { fetchedAt, data: normalized.messages });
      return normalized;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

/** Read a warm message window without waiting on persistent storage or network. */
export function getCachedCommunityBootstrap(
  communityId: string,
  userId = 'anonymous',
): CommunityBootstrap | null {
  const key = bootstrapKey(communityId, userId);
  const cached = cache.get(key);
  if (
    !cached ||
    cached.data.messages.length === 0 ||
    Date.now() - cached.fetchedAt >= COMMUNITY_BOOTSTRAP_STALE_MS
  ) return null;
  // Touch the entry so the bounded cache evicts the least recently used room.
  rememberBootstrap(key, cached);
  return cached.data;
}

/** Read the latest in-process message window, including one hydrated from disk. */
export function getCachedCommunityMessageWindow(
  communityId: string,
  userId = 'anonymous',
): Message[] | null {
  const key = bootstrapKey(communityId, userId);
  const cached = messageWindowCache.get(key);
  if (
    !cached ||
    cached.data.length === 0 ||
    Date.now() - cached.fetchedAt >= COMMUNITY_BOOTSTRAP_STALE_MS
  ) return null;
  rememberMessageWindow(key, cached);
  return cached.data;
}

/** Seed the switch cache after AsyncStorage supplies a valid community window. */
export function rememberCommunityMessageWindow(
  communityId: string,
  messages: Message[],
  userId = 'anonymous',
): void {
  const rows = messages.filter((message) => !message.id.startsWith('temp-'));
  if (rows.length === 0) return;
  rememberMessageWindow(bootstrapKey(communityId, userId), {
    fetchedAt: Date.now(),
    data: rows.slice(-COMMUNITY_BOOTSTRAP_MESSAGE_LIMIT),
  });
}

/** Read a fresh timeline-card snapshot for an instant in-app community switch. */
export function getCachedCommunityContentEvents(
  communityId: string,
  userId = 'anonymous',
): ChatContentEvent[] | null {
  const key = bootstrapKey(communityId, userId);
  const cached = eventCache.get(key) ?? (() => {
    const bootstrap = cache.get(key);
    return bootstrap
      ? { fetchedAt: bootstrap.fetchedAt, data: bootstrap.data.contentEvents }
      : undefined;
  })();
  if (!cached || Date.now() - cached.fetchedAt >= COMMUNITY_BOOTSTRAP_STALE_MS) {
    return null;
  }
  rememberEvents(key, cached);
  return cached.data;
}

/** Fetch just timeline cards when messages already have a usable local window. */
export function fetchCommunityContentEvents(
  communityId: string,
  userId = 'anonymous',
): Promise<ChatContentEvent[]> {
  const key = bootstrapKey(communityId, userId);
  const cached = eventCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < COMMUNITY_BOOTSTRAP_STALE_MS) {
    rememberEvents(key, cached);
    return Promise.resolve(cached.data);
  }
  const pending = eventInflight.get(key);
  if (pending) return pending;

  const request = apiFetch<Pick<CommunityBootstrapResponse, 'content-events'>>(
    `/api/communities/${communityId}/bootstrap?section=content-events`,
  )
    .then(({ data }) => data['content-events']?.events ?? [])
    .then((events) => {
      const fetchedAt = Date.now();
      rememberEvents(key, { fetchedAt, data: events });
      const bootstrap = cache.get(key);
      if (bootstrap) {
        rememberBootstrap(key, {
          fetchedAt: bootstrap.fetchedAt,
          data: { ...bootstrap.data, contentEvents: events },
        });
      }
      return events;
    })
    .finally(() => eventInflight.delete(key));
  eventInflight.set(key, request);
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
  userId = 'anonymous',
): void {
  const key = bootstrapKey(communityId, userId);
  const window = messages
    .filter((message) => !message.id.startsWith('temp-'))
    .slice(-COMMUNITY_BOOTSTRAP_MESSAGE_LIMIT);
  rememberCommunityMessageWindow(communityId, window, userId);
  const cached = cache.get(key);
  if (!cached) return;
  rememberBootstrap(key, {
    fetchedAt: cached.fetchedAt,
    data: { ...cached.data, messages: window },
  });
}

/**
 * Fold a local content create/delete into the cached bootstrap's
 * "created a …" cards.
 *
 * WHY THIS EXISTS
 *   The chat timeline only learns about a new card from three places: the
 *   local mirror (subscribed only while the chat screen is mounted), realtime
 *   (same), or the bootstrap. Creating a resource from the Resources tab and
 *   switching to Chat inside the 15-minute window used to serve the
 *   fetch-time snapshot, so "You created a resource" was missing until an app
 *   restart. Patching the entry keeps the card there without a refetch, and
 *   never fabricates an entry — an unknown community still fetches fresh.
 */
export function patchCachedBootstrapContentEvents(
  communityId: string,
  change:
    | { kind: 'insert'; event: ChatContentEvent }
    | { kind: 'delete'; id: string },
  userId = 'anonymous',
): void {
  const key = bootstrapKey(communityId, userId);
  const cached = cache.get(key);
  const cachedEvents = eventCache.get(key);
  const currentEvents = cachedEvents?.data ?? cached?.data.contentEvents;
  if (!currentEvents) return;
  const events = change.kind === 'delete'
    ? currentEvents.filter((event) => event.id !== change.id)
    : currentEvents.some((event) => event.id === change.event.id)
      ? currentEvents
      : [...currentEvents, change.event].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
  rememberEvents(key, {
    fetchedAt: cachedEvents?.fetchedAt ?? cached?.fetchedAt ?? Date.now(),
    data: events,
  });
  if (!cached) return;
  rememberBootstrap(key, {
    fetchedAt: cached.fetchedAt,
    data: { ...cached.data, contentEvents: events },
  });
}
