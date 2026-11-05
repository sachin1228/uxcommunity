import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearDmMessageStore,
  peekDmMessages,
  rememberDmMessages,
} from './dmMessageStore';
import type { DmMessage } from './dm';

function message(id: string, createdAt: string, overrides: Partial<DmMessage> = {}): DmMessage {
  return {
    id,
    content: id,
    created_at: createdAt,
    user_id: 'u-2',
    reply_to_id: null,
    image_url: null,
    deleted_at: null,
    edited_at: null,
    users: null,
    reactions: [],
    reply_to: null,
    ...overrides,
  };
}

test('remembered rows come back in timeline order, per member and chat', () => {
  clearDmMessageStore();
  rememberDmMessages('u-1', 'c-1', [
    message('b', '2026-11-05T10:01:00Z'),
    message('a', '2026-11-05T10:00:00Z'),
  ]);

  assert.deepEqual(
    peekDmMessages('u-1', 'c-1')?.map((row) => row.id),
    ['a', 'b'],
  );
  assert.equal(peekDmMessages('u-2', 'c-1'), null);
  assert.equal(peekDmMessages('u-1', 'c-2'), null);
});

test('a later row updates the same id instead of duplicating it', () => {
  clearDmMessageStore();
  rememberDmMessages('u-1', 'c-1', [message('a', '2026-11-05T10:00:00Z')]);
  rememberDmMessages('u-1', 'c-1', [
    message('a', '2026-11-05T10:00:00Z', { content: 'edited' }),
  ]);

  const rows = peekDmMessages('u-1', 'c-1');
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0].content, 'edited');
});

test('optimistic rows never enter the shared window', () => {
  clearDmMessageStore();
  rememberDmMessages('u-1', 'c-1', [
    message('temp-1', '2026-11-05T10:00:00Z'),
    message('a', '2026-11-05T10:01:00Z'),
  ]);
  assert.deepEqual(peekDmMessages('u-1', 'c-1')?.map((row) => row.id), ['a']);
});

test('the pending conversation placeholder is never stored', () => {
  clearDmMessageStore();
  rememberDmMessages('u-1', 'new', [message('a', '2026-11-05T10:00:00Z')]);
  assert.equal(peekDmMessages('u-1', 'new'), null);
});
