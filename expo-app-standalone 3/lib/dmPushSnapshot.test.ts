import assert from 'node:assert/strict';
import test from 'node:test';

import { readDmPushSnapshot } from './dmPushSnapshot';

const ROW = {
  id: 'm-1',
  conversation_id: 'c-1',
  user_id: 'u-2',
  content: 'hi there',
  image_url: null,
  reply_to_id: null,
  created_at: '2026-11-05T10:00:00Z',
  sender_name: 'John',
  sender_avatar_url: 'https://media.example/john.webp',
  reply_sender_name: null,
  reply_sender_id: null,
};

function payload(overrides: Record<string, unknown> = {}, row: Record<string, unknown> = {}) {
  return {
    type: 'dm_message',
    recipientId: 'u-1',
    conversationId: 'c-1',
    messageId: 'm-1',
    senderId: 'u-2',
    dmMessage: JSON.stringify({ ...ROW, ...row }),
    ...overrides,
  };
}

test('a complete snapshot becomes the message row', () => {
  const message = readDmPushSnapshot('u-1', payload());
  assert.equal(message?.id, 'm-1');
  assert.equal(message?.content, 'hi there');
  assert.equal(message?.created_at, '2026-11-05T10:00:00Z');
  assert.equal(message?.users?.name, 'John');
  assert.equal(message?.users?.avatar_url, 'https://media.example/john.webp');
  assert.deepEqual(message?.reactions, []);
});

test('a snapshot for another recipient, conversation or message is refused', () => {
  assert.equal(readDmPushSnapshot('u-9', payload()), null);
  assert.equal(readDmPushSnapshot('u-1', payload({ conversationId: 'c-2' })), null);
  assert.equal(readDmPushSnapshot('u-1', payload({ messageId: 'm-2' })), null);
  assert.equal(readDmPushSnapshot('u-1', payload({ senderId: 'u-9' })), null);
});

test('malformed or incomplete snapshots are refused', () => {
  assert.equal(readDmPushSnapshot('u-1', payload({ dmMessage: '{' })), null);
  assert.equal(readDmPushSnapshot('u-1', payload({ dmMessage: 'null' })), null);
  assert.equal(readDmPushSnapshot('u-1', payload({}, { created_at: 'not-a-date' })), null);
  assert.equal(readDmPushSnapshot('u-1', payload({}, { content: 42 })), null);
});

test('a reply snapshot carries its reply line', () => {
  const message = readDmPushSnapshot(
    'u-1',
    payload({}, {
      reply_to_id: 'm-0',
      reply_sender_name: 'Ada',
      reply_sender_id: 'u-3',
    }),
  );
  assert.deepEqual(message?.reply_to, {
    id: 'm-0',
    content: null,
    user_name: 'Ada',
    user_id: 'u-3',
  });
});
