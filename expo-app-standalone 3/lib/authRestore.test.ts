import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSessionRestore, type SessionProbe } from './authRestore';
import type { User } from './auth';

const cached: User = {
  id: 'user-a',
  name: 'A',
  email: 'a@example.com',
  role: 'user',
  profileComplete: true,
  avatar_url: null,
};

const fresh: User = { ...cached, name: 'A renamed' };

test('a valid session paints the server row and persists it', () => {
  const decision = resolveSessionRestore(cached, { kind: 'user', user: fresh });
  assert.equal(decision.user, fresh);
  assert.equal(decision.clearMemberState, false);
  assert.equal(decision.persistUser, true);
});

test('an expired or missing session clears the snapshot and member caches', () => {
  for (const probe of [
    { kind: 'no-session' },
    { kind: 'unauthorized' },
  ] satisfies SessionProbe[]) {
    const decision = resolveSessionRestore(cached, probe);
    assert.equal(decision.user, null);
    assert.equal(decision.clearMemberState, true);
  }
});

test('a network failure keeps the cached identity instead of signing out', () => {
  const decision = resolveSessionRestore(cached, { kind: 'offline' });
  assert.equal(decision.user, cached);
  assert.equal(decision.clearMemberState, false);
  assert.equal(decision.persistUser, false);
});

test('a network failure without a snapshot has nothing to paint', () => {
  const decision = resolveSessionRestore(null, { kind: 'offline' });
  assert.equal(decision.user, null);
  // Caches are kept: the next launch may still validate and use them.
  assert.equal(decision.clearMemberState, false);
});
