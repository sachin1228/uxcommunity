import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAuthSnapshot,
  serializeAuthSnapshot,
} from './authSnapshot';
import type { User } from './auth';

const user: User = {
  id: 'user-a',
  name: 'A',
  email: 'a@example.com',
  role: 'user',
  profileComplete: true,
  avatar_url: 'https://cdn.example.com/a.png',
};

test('a serialized snapshot round-trips', () => {
  assert.deepEqual(parseAuthSnapshot(serializeAuthSnapshot(user)), user);
});

test('corrupt, missing and wrongly-shaped snapshots are ignored', () => {
  assert.equal(parseAuthSnapshot(null), null);
  assert.equal(parseAuthSnapshot('not json'), null);
  assert.equal(parseAuthSnapshot('{}'), null);
  assert.equal(
    parseAuthSnapshot(JSON.stringify({ ...user, id: '' })),
    null,
  );
  assert.equal(
    parseAuthSnapshot(JSON.stringify({ ...user, profileComplete: 'yes' })),
    null,
  );
  assert.equal(
    parseAuthSnapshot(JSON.stringify({ ...user, role: 'owner' })),
    null,
  );
});

test('a session without a stable id is not persisted', () => {
  // The env admin session has no user row; there is nothing to key a snapshot
  // to, so its next launch simply revalidates.
  assert.equal(serializeAuthSnapshot({ ...user, id: '', role: 'admin' }), null);
});
