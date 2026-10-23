import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearCommunitiesSnapshot,
  getCommunities,
  peekCommunitiesSnapshot,
  putCommunitiesSnapshot,
  seedCommunitiesSnapshotFromDisk,
  setCommunitiesActiveUser,
  type Community,
} from './communities';

function community(id: string): Community {
  return {
    id,
    name: id,
    type: 'group',
    image_url: null,
    reference_name: null,
    is_private: false,
    enabled_tabs: ['chat'],
    owner_id: 'owner',
    member_count: 1,
    message_count: 0,
    unread_count: 0,
    last_read_at: null,
    joined_at: '2026-10-01T00:00:00Z',
    is_archived: false,
    last_message: null,
    lastReaction: null,
  };
}

test('the shared list is scoped to the active member', () => {
  clearCommunitiesSnapshot();
  setCommunitiesActiveUser('user-a');
  seedCommunitiesSnapshotFromDisk([community('a')]);
  assert.deepEqual(peekCommunitiesSnapshot()?.map((row) => row.id), ['a']);

  putCommunitiesSnapshot([community('a-live')]);
  assert.deepEqual(peekCommunitiesSnapshot()?.map((row) => row.id), ['a-live']);

  setCommunitiesActiveUser('user-b');
  assert.equal(peekCommunitiesSnapshot(), null);
  seedCommunitiesSnapshotFromDisk([community('b')]);
  assert.deepEqual(peekCommunitiesSnapshot()?.map((row) => row.id), ['b']);

  setCommunitiesActiveUser(null);
  assert.equal(peekCommunitiesSnapshot(), null);
  seedCommunitiesSnapshotFromDisk([community('late')]);
  putCommunitiesSnapshot([community('late-live')]);
  assert.equal(peekCommunitiesSnapshot(), null);

  clearCommunitiesSnapshot();
});

test('a signed-out member gets no shared list and no network read', async () => {
  clearCommunitiesSnapshot();
  const rows = await getCommunities();
  assert.deepEqual(rows, []);
});
