/**
 * Tests for the shared community bootstrap cache.
 *
 * The contract the chat hooks rely on (see hooks/useChatMessages):
 *
 *  1. A settled bootstrap response is reused inside
 *     COMMUNITY_BOOTSTRAP_STALE_MS — re-entering a chat inside the window
 *     costs no request.
 *  2. The open chat folds its live window back into that entry
 *     (patchCachedBootstrapMessages), so a re-entry paints the messages the
 *     user just saw instead of the fetch-time snapshot. Before this, every
 *     message sent after the snapshot — the user's own rows included —
 *     vanished on re-entry until some later reconnect happened to catch up.
 *  3. Patching never fabricates an entry, never moves the freshness clock and
 *     never makes an empty message window servable — the rules that keep the
 *     cache cheap and correct.
 */

import assert from 'node:assert/strict';
import test, { before, beforeEach } from 'node:test';

import {
  COMMUNITY_BOOTSTRAP_STALE_MS,
  fetchCommunityBootstrap,
  patchCachedBootstrapContentEvents,
  patchCachedBootstrapMessages,
} from './communityBootstrap';
import type { ChatContentEvent } from './chatContentEvents';
import type { Message } from './communities';

// ── A minimal Message-shaped row ───────────────────────────────────────────

function row(id: string, created_at = '2026-10-17T10:00:00Z'): Message {
  return {
    id,
    content: `message ${id}`,
    created_at,
    user_id: 'user-a',
    reply_to_id: null,
    image_url: null,
    deleted_at: null,
    users: null,
    reactions: [],
    reply_to: null,
  };
}

function bootstrapPayload(ids: string[]) {
  return {
    messages: { messages: ids.map((id) => row(id)) },
    'content-events': { events: [{ id: 'evt-1', title: 'A card' }] },
  };
}

/** A minimal content-event card, as the create response yields it. */
function contentEvent(id: string, created_at = '2026-10-17T10:02:00Z'): ChatContentEvent {
  return {
    id,
    community_id: 'cards-community',
    user_id: 'user-a',
    kind: 'resource',
    title: `card ${id}`,
    created_at,
    meta: null,
    reactions: [],
    users: null,
  };
}

// ── Transport + storage stubs ──────────────────────────────────────────────
// The cache sits on the app's API client, which replays the session cookie
// through AsyncStorage (needs a browser-like global under plain Node) and
// talks over fetch. Both are stubbed so the caching rules are exercised
// without a network; the cache itself never touches either.

const storage = new Map<string, string>();
let fetchCalls = 0;
let nextPayload: unknown = bootstrapPayload([]);

before(() => {
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  };
  (globalThis as Record<string, unknown>).fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(nextPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

beforeEach(() => {
  fetchCalls = 0;
});

// ══════════════════════════════════════════════════════════════════════════
// Reuse inside the freshness window
// ══════════════════════════════════════════════════════════════════════════

test('a settled bootstrap is reused inside the freshness window', async () => {
  nextPayload = bootstrapPayload(['m1', 'm2']);
  const first = await fetchCommunityBootstrap('cached-community');
  assert.deepEqual(first.messages.map((message) => message.id), ['m1', 'm2']);
  assert.equal(fetchCalls, 1);

  const second = await fetchCommunityBootstrap('cached-community');
  assert.deepEqual(second.messages.map((message) => message.id), ['m1', 'm2']);
  assert.equal(fetchCalls, 1, 'the second open costs no request');
});

// ══════════════════════════════════════════════════════════════════════════
// Patching — the live window survives re-entry
// ══════════════════════════════════════════════════════════════════════════

test('a re-entry serves the window the chat just folded in, with no request', async () => {
  nextPayload = bootstrapPayload(['m1', 'm2']);
  // Opening the chat: the fetch-time snapshot.
  await fetchCommunityBootstrap('reentry-community');
  assert.equal(fetchCalls, 1);

  // The chat stays open and sends m3; its echo confirms it and the hook folds
  // its current window back into the entry.
  patchCachedBootstrapMessages('reentry-community', [
    row('m1'),
    row('m2', '2026-10-17T10:01:00Z'),
    row('m3', '2026-10-17T10:03:00Z'),
  ]);

  // Going back and re-entering inside the window: everything sent since the
  // snapshot is still there — this is the bug the patch exists for.
  const reopened = await fetchCommunityBootstrap('reentry-community');
  assert.deepEqual(
    reopened.messages.map((message) => message.id),
    ['m1', 'm2', 'm3'],
    'the just-sent rows survive re-entry',
  );
  assert.equal(fetchCalls, 1, 'and the re-entry still costs no request');
});

test('the patch replaces the snapshot instead of accumulating beside it', async () => {
  nextPayload = bootstrapPayload(['m1']);
  await fetchCommunityBootstrap('replace-community');

  // The hook always passes its FULL current window (realtime rows, sends and
  // catch-up pages merged in state), never a delta.
  patchCachedBootstrapMessages('replace-community', [row('m9')]);

  const reopened = await fetchCommunityBootstrap('replace-community');
  assert.deepEqual(reopened.messages.map((message) => message.id), ['m9']);
});

test('patching keeps the entry\u2019s other sections', async () => {
  nextPayload = bootstrapPayload(['m1']);
  const first = await fetchCommunityBootstrap('sections-community');
  patchCachedBootstrapMessages('sections-community', [row('m9')]);

  const reopened = await fetchCommunityBootstrap('sections-community');
  assert.deepEqual(
    reopened.contentEvents,
    first.contentEvents,
    'content events stay tied to their own fetch',
  );
  assert.equal(fetchCalls, 1);
});

test('patching an unknown community never fabricates an entry', async () => {
  patchCachedBootstrapMessages('never-fetched', [row('m2')]);

  nextPayload = bootstrapPayload(['m1']);
  const fetched = await fetchCommunityBootstrap('never-fetched');
  assert.deepEqual(
    fetched.messages.map((message) => message.id),
    ['m1'],
    'the network answer, not the patch',
  );
  assert.equal(fetchCalls, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// Content-event patches — "created a …" cards survive re-entry
// ══════════════════════════════════════════════════════════════════════════

test('a locally created card survives re-entry inside the freshness window', async () => {
  nextPayload = bootstrapPayload(['m1']);
  const first = await fetchCommunityBootstrap('cards-community');
  assert.deepEqual(first.contentEvents.map((event) => event.id), ['evt-1']);

  // The resource was created from its tab while the chat screen was unmounted,
  // so only the mirror's cache patch knows about it until the next fetch.
  patchCachedBootstrapContentEvents('cards-community', {
    kind: 'insert',
    event: contentEvent('evt-2'),
  });

  const reopened = await fetchCommunityBootstrap('cards-community');
  assert.deepEqual(
    reopened.contentEvents.map((event) => event.id),
    ['evt-1', 'evt-2'],
    'the "You created a …" card is on the timeline',
  );
  assert.equal(fetchCalls, 1, 'and the re-entry still costs no request');
});

test('a delivered card is idempotent by id', async () => {
  nextPayload = bootstrapPayload(['m1']);
  await fetchCommunityBootstrap('cards-dedupe');
  patchCachedBootstrapContentEvents('cards-dedupe', { kind: 'insert', event: contentEvent('evt-2') });
  patchCachedBootstrapContentEvents('cards-dedupe', { kind: 'insert', event: contentEvent('evt-2') });

  const reopened = await fetchCommunityBootstrap('cards-dedupe');
  assert.deepEqual(reopened.contentEvents.map((event) => event.id), ['evt-1', 'evt-2']);
});

test('a locally deleted card leaves the cached timeline', async () => {
  nextPayload = bootstrapPayload(['m1']);
  await fetchCommunityBootstrap('cards-delete');
  patchCachedBootstrapContentEvents('cards-delete', { kind: 'delete', id: 'evt-1' });

  const reopened = await fetchCommunityBootstrap('cards-delete');
  assert.deepEqual(reopened.contentEvents, []);
  assert.equal(fetchCalls, 1);
});

test('patching cards on an unknown community never fabricates an entry', async () => {
  patchCachedBootstrapContentEvents('cards-never-fetched', {
    kind: 'insert',
    event: contentEvent('evt-2'),
  });

  nextPayload = bootstrapPayload(['m1']);
  const fetched = await fetchCommunityBootstrap('cards-never-fetched');
  assert.deepEqual(
    fetched.contentEvents.map((event) => event.id),
    ['evt-1'],
    'the network answer, not the patch',
  );
  assert.equal(fetchCalls, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// Freshness and the empty-window rule stay intact
// ══════════════════════════════════════════════════════════════════════════

test('patching the window does not extend the freshness clock', async () => {
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    nextPayload = bootstrapPayload(['m1']);
    await fetchCommunityBootstrap('aging-community');
    patchCachedBootstrapMessages('aging-community', [row('m1'), row('m2', '2026-10-17T10:01:00Z')]);

    // Still inside the window: the patched entry is served.
    clock += COMMUNITY_BOOTSTRAP_STALE_MS - 1;
    const fresh = await fetchCommunityBootstrap('aging-community');
    assert.deepEqual(fresh.messages.map((message) => message.id), ['m1', 'm2']);
    assert.equal(fetchCalls, 1);

    // Past the window: a real refetch, exactly as before patching existed.
    clock += 2;
    await fetchCommunityBootstrap('aging-community');
    assert.equal(fetchCalls, 2, 'the patch is not a second freshness window');
  } finally {
    Date.now = realNow;
  }
});

test('a fresh response with no messages is never reused', async () => {
  nextPayload = bootstrapPayload([]);
  await fetchCommunityBootstrap('blank-community');
  assert.equal(fetchCalls, 1);

  await fetchCommunityBootstrap('blank-community');
  assert.equal(fetchCalls, 2, 'a blank window has no cursor — it must be refetched');
});

test('an entry patched down to nothing is refetched, never served blank', async () => {
  nextPayload = bootstrapPayload(['m1']);
  await fetchCommunityBootstrap('emptied-community');

  // The retention sweep emptied the on-screen window; the hook folds that
  // state back in rather than leaving rows the server has deleted.
  patchCachedBootstrapMessages('emptied-community', []);

  nextPayload = bootstrapPayload(['m2']);
  const refetched = await fetchCommunityBootstrap('emptied-community');
  assert.deepEqual(refetched.messages.map((message) => message.id), ['m2']);
  assert.equal(fetchCalls, 2);
});
