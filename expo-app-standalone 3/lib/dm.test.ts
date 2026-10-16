/**
 * Tests for the pure DM module — the request lifecycle, list previews and
 * composer states shared with the web thread.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dmComposerState,
  dmConversationPreview,
  dmTimestampLabel,
  isIncomingRequest,
  isOutgoingRequest,
  newestMessageAt,
  requestHintForPeer,
  unreadPillLabel,
  uuidV4,
  type DmConversation,
  type DmMessage,
} from './dm';

const VIEWER = 'u-viewer';
const PEER = 'u-peer';

function conversation(overrides: Partial<DmConversation> = {}): DmConversation {
  return {
    id: 'c1',
    peer: { id: PEER, name: 'Ada', avatar_url: null },
    last_message: null,
    unread_count: 0,
    my_last_read_at: null,
    last_message_at: null,
    last_reaction: null,
    request_state: 'accepted',
    requested_by: null,
    blocked_by_me: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Request lifecycle
// ---------------------------------------------------------------------------

test('incoming vs outgoing requests are defined by requested_by', () => {
  const incoming = conversation({ request_state: 'pending', requested_by: PEER });
  const outgoing = conversation({ request_state: 'pending', requested_by: VIEWER });

  assert.equal(isIncomingRequest(incoming, VIEWER), true);
  assert.equal(isOutgoingRequest(incoming, VIEWER), false);
  assert.equal(isIncomingRequest(outgoing, VIEWER), false);
  assert.equal(isOutgoingRequest(outgoing, VIEWER), true);
  // A pending conversation without a requester yet is neither side's answer.
  const unclaimed = conversation({ request_state: 'pending', requested_by: null });
  assert.equal(isIncomingRequest(unclaimed, VIEWER), false);
  assert.equal(isOutgoingRequest(unclaimed, VIEWER), false);
});

test('composer state follows the web precedence: blocked, incoming, outgoing, rejected, ready', () => {
  assert.equal(
    dmComposerState(conversation({ blocked_by_me: true }), VIEWER).kind,
    'blocked',
  );
  assert.equal(
    dmComposerState(conversation({ request_state: 'pending', requested_by: PEER }), VIEWER).kind,
    'incoming-request',
  );
  assert.equal(
    dmComposerState(conversation({ request_state: 'pending', requested_by: VIEWER }), VIEWER).kind,
    'outgoing-request',
  );
  assert.equal(
    dmComposerState(conversation({ request_state: 'rejected' }), VIEWER).kind,
    'rejected',
  );
  assert.equal(dmComposerState(conversation(), VIEWER).kind, 'ready');
});

test('the one-message hint names the peer', () => {
  assert.ok(requestHintForPeer('Ada').includes('Ada'));
});

// ---------------------------------------------------------------------------
// List previews
// ---------------------------------------------------------------------------

test('an incoming request shows "Message request" instead of the text', () => {
  const pending = conversation({
    request_state: 'pending',
    requested_by: PEER,
    last_message: {
      id: 'm1',
      content: 'hi',
      image_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      user_id: PEER,
      deleted_at: null,
      edited_at: null,
    },
  });

  assert.deepEqual(dmConversationPreview(pending, VIEWER), {
    text: 'Message request',
    muted: true,
  });
});

test('own messages preview with a "You:" prefix; photos and deletions read true', () => {
  const withMessage = (message: DmConversation['last_message']) => conversation({ last_message: message });

  assert.equal(
    dmConversationPreview(
      withMessage({
        id: 'm1',
        content: 'hello',
        image_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
        user_id: VIEWER,
        deleted_at: null,
        edited_at: null,
      }),
      VIEWER,
    ).text,
    'You: hello',
  );

  assert.equal(
    dmConversationPreview(
      withMessage({
        id: 'm2',
        content: null,
        image_url: 'https://x/y.jpg',
        created_at: '2026-01-01T00:00:00.000Z',
        user_id: PEER,
        deleted_at: null,
        edited_at: null,
      }),
      VIEWER,
    ).text,
    'Photo',
  );

  assert.equal(
    dmConversationPreview(
      withMessage({
        id: 'm3',
        content: 'gone',
        image_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
        user_id: PEER,
        deleted_at: '2026-01-02T00:00:00.000Z',
        edited_at: null,
      }),
      VIEWER,
    ).text,
    'Message deleted',
  );
});

test('a reaction preview outranks the message text', () => {
  const reacted = conversation({
    last_message: {
      id: 'm1',
      content: 'ship it',
      image_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      user_id: PEER,
      deleted_at: null,
      edited_at: null,
    },
    last_reaction: {
      emoji: '❤️',
      user_id: VIEWER,
      first_name: 'You',
      message_preview: 'ship it',
    },
  });

  assert.equal(dmConversationPreview(reacted, VIEWER).text, 'You reacted ❤️ to: ship it');
});

test('unread pill caps at 99+', () => {
  assert.equal(unreadPillLabel(1), '1');
  assert.equal(unreadPillLabel(99), '99');
  assert.equal(unreadPillLabel(150), '99+');
});

test('timestamp buckets match the rest of the app', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');
  const at = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  assert.equal(dmTimestampLabel(at(10_000), now), 'now');
  assert.equal(dmTimestampLabel(at(5 * 60_000), now), '5m');
  assert.equal(dmTimestampLabel(at(3 * 3_600_000), now), '3h');
  assert.equal(dmTimestampLabel(at(2 * 86_400_000), now), '2d');
  assert.equal(dmTimestampLabel(null, now), '');
});

// ---------------------------------------------------------------------------
// Nonce + read watermark
// ---------------------------------------------------------------------------

test('uuidV4 has the shape the server validates (and is unique enough)', () => {
  const a = uuidV4();
  const b = uuidV4();
  const shape =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.ok(shape.test(a));
  assert.ok(shape.test(b));
  assert.notEqual(a, b);
});

test('newestMessageAt finds the latest message regardless of order', () => {
  const message = (id: string, created_at: string): DmMessage => ({
    id,
    content: id,
    created_at,
    user_id: PEER,
    reply_to_id: null,
    image_url: null,
    deleted_at: null,
    edited_at: null,
    users: null,
    reactions: [],
    reply_to: null,
  });

  assert.equal(
    newestMessageAt([
      message('a', '2026-01-01T00:00:00.000Z'),
      message('c', '2026-01-03T00:00:00.000Z'),
      message('b', '2026-01-02T00:00:00.000Z'),
    ]),
    '2026-01-03T00:00:00.000Z',
  );
  assert.equal(newestMessageAt([]), null);
});
