import assert from 'node:assert/strict';
import test from 'node:test';
import type { OwnProfile } from './profile';
import { ownProfileCacheSnapshot, ownProfileFromCache } from './profileCache';

test('own-profile persistence excludes email and pending verification data', () => {
  const profile = {
    user: { name: 'Taylor', email: 'private@example.test', created_at: '2024-01-01' },
    profile: null,
    roleLabel: 'Designer',
    company: null,
    pendingCompany: { email: 'challenge@example.test', token: 'private-challenge' },
  } as unknown as OwnProfile;

  const snapshot = ownProfileCacheSnapshot(profile);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('private@example.test'), false);
  assert.equal(serialized.includes('challenge@example.test'), false);
  assert.equal(serialized.includes('private-challenge'), false);
  assert.equal(ownProfileFromCache(snapshot).pendingCompany, null);
});
