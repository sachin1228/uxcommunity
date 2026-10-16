/**
 * Tests for the chat content-card helpers — the ports of the web
 * content-notifications and content-events logic. The card style and its
 * source fields must match the web byte-for-byte, so the text helpers are
 * pinned here rather than eyeballed on screen.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHAT_CONTENT_KIND_THEME,
  chatContentEventFromCreated,
  chatContentKindForTab,
  createAuthorCache,
  firstLine,
  fmtEventSchedule,
  isMissingRouteError,
  mergeChatTimeline,
  prettyUrl,
  splitBody,
  tabForChatContentKind,
  withArticle,
  DEFAULT_AUTHOR_CACHE_MAX_ENTRIES,
} from './chatContentEvents';

// ─── Kind labels & theming ────────────────────────────────────────────────

test('kind themes carry the web labels and ds accents', () => {
  assert.equal(CHAT_CONTENT_KIND_THEME.thread.label, 'Thread');
  assert.equal(CHAT_CONTENT_KIND_THEME.thread.accent, '#398e4a');
  assert.equal(CHAT_CONTENT_KIND_THEME.showcase.accent, '#8e4ec6');
  assert.equal(CHAT_CONTENT_KIND_THEME.resource.accent, '#8e4ec6');
  assert.equal(CHAT_CONTENT_KIND_THEME.event.accent, '#ff990a');
});

test('tab and kind spellings round-trip', () => {
  for (const tab of ['threads', 'showcase', 'resources', 'events'] as const) {
    assert.equal(tabForChatContentKind(chatContentKindForTab(tab)), tab);
  }
});

test('withArticle picks the article like the web header line', () => {
  assert.equal(withArticle('thread'), 'a thread');
  assert.equal(withArticle('showcase'), 'a showcase');
  assert.equal(withArticle('resource'), 'a resource');
  assert.equal(withArticle('event'), 'an event');
});

test('only a 404 reads as a server that lacks the route', () => {
  const missing = Object.assign(new Error('HTTP 404'), { status: 404 });
  assert.equal(isMissingRouteError(missing), true);

  // Everything else is a real failure — never a fallback trigger.
  assert.equal(isMissingRouteError(Object.assign(new Error('HTTP 401'), { status: 401 })), false);
  assert.equal(isMissingRouteError(Object.assign(new Error('HTTP 500'), { status: 500 })), false);
  assert.equal(isMissingRouteError(new Error('Network request failed')), false);
  assert.equal(isMissingRouteError(null), false);
  assert.equal(isMissingRouteError(undefined), false);
});

// ─── Text helpers ─────────────────────────────────────────────────────────

test('firstLine collapses whitespace and truncates with an ellipsis', () => {
  assert.equal(firstLine('  hello   world  '), 'hello world');
  assert.equal(firstLine('a'.repeat(95), 90), `${'a'.repeat(90)}…`);
  assert.equal(firstLine('short', 90), 'short');
});

test('splitBody splits headline from body like the detail pages', () => {
  assert.deepEqual(splitBody('Just a headline'), { title: 'Just a headline', subtitle: null });
  assert.deepEqual(splitBody('Headline\n\nBody line one\nBody line two'), {
    title: 'Headline',
    subtitle: 'Body line one Body line two',
  });
  // A leading newline must not empty the title.
  assert.deepEqual(splitBody('\nHeadline only'), { title: 'Headline only', subtitle: null });
  assert.deepEqual(splitBody('   '), { title: '', subtitle: null });
});

test('prettyUrl keeps the hostname and the first path segment', () => {
  assert.equal(prettyUrl('https://www.figma.com/design/abc/file'), 'www.figma.com/design…');
  assert.equal(prettyUrl('https://example.com'), 'example.com');
  assert.equal(prettyUrl('not a url'), 'not a url');
});

test('fmtEventSchedule renders the web shape (day, date · local time)', () => {
  const out = fmtEventSchedule('2026-10-17T12:15:00.000Z');
  assert.match(out, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM)$/);
  assert.equal(fmtEventSchedule('nonsense'), '');
});

// ─── Created item → card event ────────────────────────────────────────────

const createdBase = {
  id: 'c-1',
  community_id: 'room-1',
  user_id: 'u-1',
  title: 'Hello',
  created_at: '2026-10-16T10:00:00.000Z',
};

test('a created thread maps its first image attachment and video poster', () => {
  const event = chatContentEventFromCreated('threads', {
    ...createdBase,
    attachments: [
      { url: 'https://cdn/video.mp4', type: 'video/mp4', poster: 'https://cdn/poster.jpg' },
      { url: 'https://cdn/img.png', type: 'image/png' },
    ],
    users: { name: 'Sara', avatar_url: null },
  });
  assert.equal(event.kind, 'thread');
  assert.equal(event.meta?.image_url, 'https://cdn/img.png');
  assert.equal(event.meta?.video_poster, 'https://cdn/poster.jpg');
  assert.deepEqual(event.users, { name: 'Sara', avatar_url: null });
  assert.deepEqual(event.reactions, []);
});

test('a created showcase prefers its own image_url and falls back to author', () => {
  const event = chatContentEventFromCreated('showcase', {
    ...createdBase,
    image_url: 'https://cdn/cover.jpg',
    author: { name: 'Dev', avatar_url: 'https://cdn/avatar.png' },
  });
  assert.equal(event.kind, 'showcase');
  assert.equal(event.meta?.image_url, 'https://cdn/cover.jpg');
  assert.deepEqual(event.users, { name: 'Dev', avatar_url: 'https://cdn/avatar.png' });
});

test('a created resource carries its type, link and description', () => {
  const event = chatContentEventFromCreated('resources', {
    ...createdBase,
    resource_type: 'figma',
    url: 'https://figma.com/file/x',
    description: 'A kit',
  });
  assert.equal(event.kind, 'resource');
  assert.equal(event.meta?.resource_type, 'figma');
  assert.equal(event.meta?.url, 'https://figma.com/file/x');
  assert.equal(event.meta?.description, 'A kit');
});

test('a created event carries its schedule, cover and RSVP count', () => {
  const event = chatContentEventFromCreated('events', {
    ...createdBase,
    cover_image_url: 'https://cdn/ev.jpg',
    event_date: '2026-10-17T12:15:00.000Z',
    end_date: '2026-10-17T14:00:00.000Z',
    is_online: true,
    rsvp_count: 2,
  });
  assert.equal(event.kind, 'event');
  assert.equal(event.meta?.image_url, 'https://cdn/ev.jpg');
  assert.equal(event.meta?.event_date, '2026-10-17T12:15:00.000Z');
  assert.equal(event.meta?.is_online, true);
  assert.equal(event.meta?.rsvp_count, 2);
});

// ─── Timeline merge ───────────────────────────────────────────────────────

test('mergeChatTimeline interleaves by time with messages first on a tie', () => {
  const messages = [
    { id: 'm1', created_at: '2026-10-16T10:00:00.000Z' },
    { id: 'm2', created_at: '2026-10-16T10:02:00.000Z' },
  ];
  const events = [
    { id: 'c1', created_at: '2026-10-16T10:02:00.000Z' },
    { id: 'c2', created_at: '2026-10-16T10:01:00.000Z' },
  ];
  const merged = mergeChatTimeline(messages, events);
  assert.deepEqual(
    merged.map((item) => (item.kind === 'message' ? item.message.id : item.event.id)),
    ['m1', 'c2', 'm2', 'c1'],
  );
});

test('mergeChatTimeline is a no-op for empty sides', () => {
  const messages = [{ id: 'm1', created_at: '2026-10-16T10:00:00.000Z' }];
  assert.equal(mergeChatTimeline(messages, []).length, 1);
  assert.equal(mergeChatTimeline([], []).length, 0);
});

// ─── Author cache ─────────────────────────────────────────────────────────

test('author cache is bounded and evicts the coldest entry', () => {
  const cache = createAuthorCache(2);
  cache.set('a', { name: 'A', avatar_url: null });
  cache.set('b', { name: 'B', avatar_url: null });
  // Re-writing "a" makes "b" the coldest.
  cache.set('a', { name: 'A2', avatar_url: null });
  cache.set('c', { name: 'C', avatar_url: null });

  assert.equal(cache.size(), 2);
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual(cache.get('a'), { name: 'A2', avatar_url: null });
  assert.deepEqual(cache.get('c'), { name: 'C', avatar_url: null });
});

test('author cache clamps a silly cap instead of evicting every write', () => {
  const cache = createAuthorCache(0);
  cache.set('a', { name: 'A', avatar_url: null });
  assert.equal(cache.size(), 1);
  assert.equal(DEFAULT_AUTHOR_CACHE_MAX_ENTRIES, 200);
});
