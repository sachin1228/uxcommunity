import assert from 'node:assert/strict';
import test from 'node:test';

import { settleAbandonedRegistration } from './pushRegistrationState';

const NOW = 1_760_000_000_000;

test('an abandoned "registering" marker is settled to unknown', () => {
  const settled = settleAbandonedRegistration(
    { status: 'registering', error: null, checkedAt: NOW - 5_000, token: 'expo-a' },
    NOW,
  );

  assert.deepEqual(settled, {
    status: 'unknown',
    error: null,
    checkedAt: NOW,
    token: 'expo-a',
  });
});

test('a settled status is never overwritten by an abandoned run', () => {
  for (const status of ['registered', 'denied', 'error', 'unknown']) {
    assert.equal(
      settleAbandonedRegistration({ status, error: 'kept', checkedAt: NOW - 1 }, NOW),
      null,
    );
  }
});

test('an in-flight marker that also recorded an error is cleared', () => {
  const settled = settleAbandonedRegistration(
    { status: 'registering', error: 'stale reason', checkedAt: null },
    NOW,
  );

  assert.equal(settled?.status, 'unknown');
  assert.equal(settled?.error, null);
});
