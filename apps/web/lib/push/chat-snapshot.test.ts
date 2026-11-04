import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChatPushSnapshot, withChatPushSnapshot } from './chat-snapshot';

const params = {
  communityId: 'room', messageId: 'message', senderId: 'sender', senderName: 'Sender', content: 'exact\nmessage',
  snapshot: { created_at: '2026-11-04T12:00:00Z', image_url: null, reply_to_id: null, mentions: [],
    reply_to_content_id: null, reply_content_kind: null, reply_content_title: null },
};
test('push snapshots contain the committed row rather than the notification preview', () => {
  const encoded = buildChatPushSnapshot(params)!;
  const row = JSON.parse(encoded);
  assert.equal(row.content, 'exact\nmessage');
  assert.equal(row.created_at, params.snapshot.created_at);
  assert.equal(row.id, params.messageId);
  assert.equal(row.community_id, params.communityId);
  assert.equal(row.user_id, params.senderId);
});
test('old senders without a committed timestamp do not fabricate a message snapshot', () => {
  assert.equal(buildChatPushSnapshot({ ...params, snapshot: undefined }), undefined);
});
test('oversized and multibyte messages keep the ordinary notification instead', () => {
  assert.equal(buildChatPushSnapshot({ ...params, content: '🙂'.repeat(500) }), undefined);
  const base = { title: 'Room', data: { recipientId: 'member' } };
  assert.deepEqual(withChatPushSnapshot(base, undefined), base);
  const longEnvelope = { title: 'r'.repeat(2_900) };
  assert.deepEqual(withChatPushSnapshot(longEnvelope, buildChatPushSnapshot(params)), longEnvelope);
});
test('snapshot budget includes JSON escaping and the rest of the notification', () => {
  const encoded = buildChatPushSnapshot(params)!;
  const payload = withChatPushSnapshot({ title: 'Room', recipientId: 'member' }, encoded);
  assert.equal(payload.chatMessage, encoded);
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).byteLength <= 3_000);
});
