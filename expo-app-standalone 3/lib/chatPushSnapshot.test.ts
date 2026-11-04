import assert from 'node:assert/strict';
import test from 'node:test';
import { readCommunityPushSnapshot } from './chatPushSnapshot';

const row = { id: 'message', community_id: 'room', user_id: 'sender', content: 'hello\nthere',
  image_url: null, created_at: '2026-11-04T12:00:00Z' };
const data = { recipientId: 'member', communityId: 'room', messageId: 'message', chatMessage: JSON.stringify(row) };
test('a matching recipient can read the exact message carried by a push or native hint', () => {
  assert.deepEqual(readCommunityPushSnapshot('member', data), row);
  assert.deepEqual(readCommunityPushSnapshot('member', { ...data, recipientId: undefined, userId: 'member' }), row);
});
test('preview-only, foreign-account and mismatched message/room payloads cannot seed the cache', () => {
  assert.equal(readCommunityPushSnapshot('other', data), null);
  assert.equal(readCommunityPushSnapshot('member', { ...data, communityId: 'other' }), null);
  assert.equal(readCommunityPushSnapshot('member', { ...data, messageId: 'other' }), null);
  assert.equal(readCommunityPushSnapshot('member', { communityId: 'room', message: 'preview' }), null);
});
test('corrupt, oversized and incomplete snapshots are ignored', () => {
  for (const chatMessage of ['{', 'null', '[]', 'x'.repeat(2_001), JSON.stringify({ ...row, created_at: 'bad' }),
    JSON.stringify({ ...row, content: undefined }), JSON.stringify({ ...row, image_url: 123 })]) {
    assert.equal(readCommunityPushSnapshot('member', { ...data, chatMessage }), null);
  }
});
