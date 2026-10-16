/**
 * Chat-timeline content events — the React Native port of the web modules
 * that feed the chat's permanent "created a …" cards:
 *
 *   apps/web/lib/communities/content-notifications.ts  (theming + text helpers)
 *   apps/web/lib/communities/content-events.ts         (row → card fields)
 *   apps/web/lib/communities/cache/content-mirror.ts   (create/delete payloads)
 *
 * Kept dependency-free and pure so the cards read identically on both clients
 * and the logic runs under plain Node in the test suite: the live hook
 * (hooks/useChatContentEvents) and the card (components/chat) only render what
 * this module computes.
 *
 * The web also keeps a legacy live-thread bubble (ThreadNotificationBubble)
 * beside this unified card, shown only for a thread that arrived over realtime
 * since the page loaded; after a reload the same thread re-renders through the
 * unified card. Mobile has one source for both cases, so it renders the
 * unified card always — the state the web converges to.
 */

import { deviceOffsetMinutes, formatOffset } from './eventTimezone';
import type { Reaction } from './chat';

// ─── Types ────────────────────────────────────────────────────────────────

/** The four content kinds a "created a …" card can stand for. */
export type ChatContentKind = 'thread' | 'showcase' | 'resource' | 'event';

/**
 * Optional rich fields the cards render — the same ContentEventMeta the web
 * server embeds in the bootstrap/history rows and the realtime payloads.
 */
export interface ChatContentEventMeta {
  /** Cover/thumbnail image (showcase media, event cover, thread attachment). */
  image_url?: string | null;
  /** First video attachment (poster frame renders as the thumbnail). */
  video_poster?: string | null;
  description?: string | null;
  /** Resource type value ("figma", "article", …). */
  resource_type?: string | null;
  /** Resource link (rendered as "figma.com/…" subtitle). */
  url?: string | null;
  event_date?: string | null;
  end_date?: string | null;
  is_online?: boolean | null;
  /** RSVP snapshot — refreshed server-side on every page load. */
  rsvp_count?: number | null;
  /** Comments on the item's own detail page. */
  comment_count?: number | null;
}

/** One item in the chat timeline: the mobile CachedContentEvent. */
export interface ChatContentEvent {
  id: string;
  community_id: string;
  user_id: string;
  kind: ChatContentKind;
  title: string;
  created_at: string;
  meta?: ChatContentEventMeta | null;
  /** Emoji reactions on the card, grouped like message reactions. */
  reactions?: Reaction[];
  users: { name: string; avatar_url: string | null } | null;
}

/** Tab keys as they appear in the community nav. */
export type ChatContentTab = 'threads' | 'showcase' | 'resources' | 'events';

// ─── Per-kind visual identity ─────────────────────────────────────────────

export interface ChatContentKindTheme {
  /** Eyebrow label / the noun in "created a …". */
  label: string;
  /** Eyebrow text color on someone else's card. */
  accent: string;
}

/**
 * Mirrors the web KIND_THEME — the ds-green/purple/amber values are identical
 * in the light and dark scales, so one constant serves both schemes.
 */
export const CHAT_CONTENT_KIND_THEME: Record<ChatContentKind, ChatContentKindTheme> = {
  thread: { label: 'Thread', accent: '#398e4a' }, // --ds-green-800
  showcase: { label: 'Showcase', accent: '#8e4ec6' }, // --ds-purple-700
  resource: { label: 'Resource', accent: '#8e4ec6' }, // --ds-purple-700
  event: { label: 'Event', accent: '#ff990a' }, // --ds-amber-800
};

/** "a thread" vs "an event" — the vowel-taking nouns get "an". */
export function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** The nav tab a kind lives under, and back — the two spellings of the same area. */
const KIND_BY_TAB: Record<ChatContentTab, ChatContentKind> = {
  threads: 'thread',
  showcase: 'showcase',
  resources: 'resource',
  events: 'event',
};

const TAB_BY_KIND: Record<ChatContentKind, ChatContentTab> = {
  thread: 'threads',
  showcase: 'showcase',
  resource: 'resources',
  event: 'events',
};

export function tabForChatContentKind(kind: ChatContentKind): ChatContentTab {
  return TAB_BY_KIND[kind];
}

export function chatContentKindForTab(tab: ChatContentTab): ChatContentKind {
  return KIND_BY_TAB[tab];
}

// ─── Text helpers (ports of the web content-notifications exports) ────────

/** First line of a text field, truncated for the subtitle. */
export function firstLine(text: string, max = 90): string {
  const line = text.trim().replace(/\s+/g, ' ');
  if (line.length <= max) return line;
  return `${line.slice(0, max).trimEnd()}…`;
}

/**
 * Thread and showcase bodies store their whole text in `title`. The chat card
 * renders the first line as the title and the remaining lines as the
 * description — matching how the detail pages open with a headline + body.
 */
export function splitBody(text: string): { title: string; subtitle: string | null } {
  const normalized = text.trim();
  if (!normalized) return { title: '', subtitle: null };
  const nl = normalized.search(/\r?\n/);
  if (nl === -1) return { title: normalized, subtitle: null };
  const title = normalized.slice(0, nl).trim();
  const rest = normalized.slice(nl).trim();
  return { title: title || normalized, subtitle: rest ? firstLine(rest, 110) : null };
}

/** "figma.com/design/xyz" — hostname (+ first path segment) for link subtitles. */
export function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean)[0];
    return segment ? `${parsed.hostname}${parsed.pathname === '/' ? '' : `/${segment}…`}` : parsed.hostname;
  } catch {
    return url;
  }
}

/** "Sat, Sep 28 · 5:00 PM" from an ISO start (year dropped, en-US like web). */
export function fmtEventSchedule(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

/**
 * The zone an instant lands in for this viewer — "UTC+5:30". Web renders the
 * abbreviation too ("EDT · UTC-4:00") when the runtime names one; the device
 * offset is the part both clients share, and a GMT-style name is the offset
 * under another label anyway. `offsetMinutes` is for tests, exactly like the
 * offset parameter pattern the web event-time module uses.
 */
export function viewerZoneLabel(iso: string, offsetMinutes?: number): string {
  const date = new Date(iso);
  const at = Number.isNaN(date.getTime()) ? new Date() : date;
  return formatOffset(offsetMinutes ?? deviceOffsetMinutes(at));
}

// ─── Created item → card event (port of the web metaFor switch) ───────────

/** First image attachment's URL, or null. */
function firstImageUrl(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments as Array<Record<string, unknown>>) {
    if (typeof a?.url !== 'string') continue;
    if (typeof a?.type === 'string' && a.type.startsWith('image/')) return a.url;
  }
  return null;
}

/** First video attachment's poster frame, or null. */
function firstVideoPoster(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments as Array<Record<string, unknown>>) {
    if (typeof a?.poster === 'string' && a.poster) return a.poster;
  }
  return null;
}

/**
 * The fields the content APIs return on the item they just created — a
 * structural subset of the four shapes, so this stays importable without the
 * API client (which reaches into React Native storage at module load).
 */
export interface CreatedContentLike {
  id: string;
  community_id: string;
  user_id: string;
  title: string;
  created_at: string;
  attachments?: Array<{ url: string; type?: string | null; poster?: string | null }> | null;
  image_url?: string | null;
  description?: string | null;
  resource_type?: string | null;
  url?: string | null;
  event_date?: string | null;
  end_date?: string | null;
  is_online?: boolean | null;
  cover_image_url?: string | null;
  rsvp_count?: number | null;
  users?: { name: string; avatar_url: string | null } | null;
  /** Showcase posts hydrate their author as `author`, not `users`. */
  author?: { name: string; avatar_url: string | null } | null;
}

/**
 * Maps a just-created content item (as the create API answers) to the card
 * event the chat timeline inserts locally — the same fields the server
 * embeds before broadcasting content-insert (web contentEventPayload), so the
 * mirrored card and the realtime echo that follows it are indistinguishable.
 */
export function chatContentEventFromCreated(
  tab: ChatContentTab,
  item: CreatedContentLike,
): ChatContentEvent {
  const kind = chatContentKindForTab(tab);
  let meta: ChatContentEventMeta;
  switch (kind) {
    case 'thread':
      meta = {
        image_url: firstImageUrl(item.attachments),
        video_poster: firstVideoPoster(item.attachments),
        description: item.title,
      };
      break;
    case 'showcase':
      meta = {
        image_url: item.image_url ?? firstImageUrl(item.attachments),
        video_poster: firstVideoPoster(item.attachments),
      };
      break;
    case 'resource':
      meta = {
        resource_type: item.resource_type ?? null,
        url: item.url ?? null,
        description: item.description ?? null,
      };
      break;
    case 'event':
      meta = {
        image_url: item.cover_image_url ?? null,
        description: item.description ?? null,
        event_date: item.event_date ?? null,
        end_date: item.end_date ?? null,
        is_online: item.is_online === true,
        rsvp_count: item.rsvp_count ?? 0,
      };
      break;
  }
  return {
    id: item.id,
    community_id: item.community_id,
    user_id: item.user_id,
    kind,
    title: item.title,
    created_at: item.created_at,
    meta,
    reactions: [],
    users: item.users ?? item.author ?? null,
  };
}

// ─── Timeline merge ───────────────────────────────────────────────────────

export type ChatTimelineItem<M, E> =
  | { kind: 'message'; created_at: string; message: M }
  | { kind: 'content'; created_at: string; event: E };

/**
 * Interleaves chat messages and content cards into one ascending timeline.
 *
 * Sort is by created_at with messages first on a tie (they are pushed first
 * and Array.prototype.sort is stable) — the exact ordering the web
 * MessageList merge produces, so a card can never hop past a message that
 * shares its timestamp.
 */
export function mergeChatTimeline<
  M extends { id: string; created_at: string },
  E extends { id: string; created_at: string },
>(messages: readonly M[], events: readonly E[]): Array<ChatTimelineItem<M, E>> {
  const items: Array<ChatTimelineItem<M, E>> = [
    ...messages.map((message) => ({
      kind: 'message' as const,
      created_at: message.created_at,
      message,
    })),
    ...events.map((event) => ({
      kind: 'content' as const,
      created_at: event.created_at,
      event,
    })),
  ];
  return items.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

// ─── Bounded author cache ─────────────────────────────────────────────────

export interface ChatContentAuthor {
  name: string;
  avatar_url: string | null;
}

export interface AuthorCache {
  get(uid: string): ChatContentAuthor | undefined;
  set(uid: string, author: ChatContentAuthor): void;
  size(): number;
  clear(): void;
}

/** Hard cap on remembered authors — far beyond one community's active creators. */
export const DEFAULT_AUTHOR_CACHE_MAX_ENTRIES = 200;

/**
 * LRU-on-write author cache for cards that arrived over realtime (the payload
 * carries only `user_id`; the name/avatar are resolved lazily per member).
 * Same eviction rule as lib/nameCache.ts: a re-resolved author moves to the
 * back, so the front of a plain Map is exactly the coldest entry.
 */
export function createAuthorCache(
  maxEntries: number = DEFAULT_AUTHOR_CACHE_MAX_ENTRIES,
): AuthorCache {
  const limit = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<string, ChatContentAuthor>();

  return {
    get: (uid) => entries.get(uid),

    set(uid, author) {
      entries.delete(uid);
      entries.set(uid, author);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },

    size: () => entries.size,
    clear: () => entries.clear(),
  };
}
