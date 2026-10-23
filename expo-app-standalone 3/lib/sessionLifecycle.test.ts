import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearMemberScopedState,
  createSessionEpochClock,
  createSignOutCoordinator,
  isUnauthorizedForCurrentSession,
  performLogout,
  settleWithin,
  type LogoutSteps,
  type SignOutSteps,
} from './sessionLifecycle';

function recorder() {
  const calls: string[] = [];
  const step = (name: string, value: unknown = undefined) => async () => {
    calls.push(name);
    return value;
  };
  return { calls, step };
}

function memberSteps(
  rec: ReturnType<typeof recorder>,
  overrides: Partial<SignOutSteps> = {},
): SignOutSteps {
  return {
    invalidateSession: () => void rec.calls.push('invalidateSession'),
    resetRealtime: () => void rec.calls.push('resetRealtime'),
    markSignedOut: () => void rec.calls.push('markSignedOut'),
    clearSession: async () => void rec.calls.push('clearSession'),
    clearQueries: () => void rec.calls.push('clearQueries'),
    clearLists: () => void rec.calls.push('clearLists'),
    resetReads: () => void rec.calls.push('resetReads'),
    clearSnapshot: async () => void rec.calls.push('clearSnapshot'),
    clearCaches: async () => void rec.calls.push('clearCaches'),
    ...overrides,
  };
}

test('a late validation is not current after sign-out or account replacement', () => {
  const clock = createSessionEpochClock();
  const userAValidation = clock.current();

  assert.equal(clock.isCurrent(userAValidation), true);

  // User A signs out / user B signs in.
  const userBValidation = clock.advance();
  assert.equal(clock.isCurrent(userAValidation), false);
  assert.equal(clock.isCurrent(userBValidation), true);

  // The late A response must not be applied; B's response may.
  clock.advance(); // another replacement
  assert.equal(clock.isCurrent(userBValidation), false);
});

test('a stale 401 from the previous cookie is ignored', () => {
  assert.equal(isUnauthorizedForCurrentSession('token-a', 'token-b'), false);
  assert.equal(isUnauthorizedForCurrentSession('token-a', null), false);
  assert.equal(isUnauthorizedForCurrentSession('token-a', undefined), false);
  assert.equal(isUnauthorizedForCurrentSession(null, 'token-b'), false);
  assert.equal(isUnauthorizedForCurrentSession('token-b', 'token-b'), true);
});

test('expired-session teardown gates the identity before async clears', async () => {
  const rec = recorder();
  const coordinator = createSignOutCoordinator(memberSteps(rec));

  assert.equal(await coordinator.signOut(), true);
  assert.deepEqual(rec.calls.slice(0, 4), [
    'invalidateSession',
    'resetRealtime',
    'markSignedOut',
    'clearSession',
  ]);
  assert.deepEqual(rec.calls.slice(4), [
    'clearQueries',
    'clearLists',
    'resetReads',
    'clearSnapshot',
    'clearCaches',
  ]);
});

test('simultaneous 401s run one teardown, and a later expiry can run again', async () => {
  const rec = recorder();
  let releaseSession: () => void = () => {};
  const coordinator = createSignOutCoordinator(
    memberSteps(rec, {
      clearSession: () =>
        new Promise<void>((resolve) => {
          rec.calls.push('clearSession');
          releaseSession = resolve;
        }),
    }),
  );

  const first = coordinator.signOut();
  const second = coordinator.signOut();
  const third = coordinator.signOut();
  assert.equal(coordinator.isRunning(), true);

  // Only the first call entered the teardown.
  assert.equal(rec.calls.filter((name) => name === 'markSignedOut').length, 1);
  releaseSession();
  assert.deepEqual(await Promise.all([first, second, third]), [true, false, false]);
  assert.equal(coordinator.isRunning(), false);

  // A later 401 after the guard is released is a new teardown. Its own
  // clearSession is released explicitly too.
  const fourth = coordinator.signOut();
  releaseSession();
  assert.equal(await fourth, true);
});

test('teardown still clears local state when storage rejects', async () => {
  const rec = recorder();
  const coordinator = createSignOutCoordinator(
    memberSteps(rec, {
      clearSession: async () => {
        rec.calls.push('clearSession');
        throw new Error('storage down');
      },
      clearCaches: async () => {
        rec.calls.push('clearCaches');
        throw new Error('storage down');
      },
      clearSnapshot: async () => {
        rec.calls.push('clearSnapshot');
        throw new Error('storage down');
      },
    }),
  );

  assert.equal(await coordinator.signOut(), true);
  assert.ok(rec.calls.includes('clearQueries'));
  assert.ok(rec.calls.includes('clearCaches'));
});

test('clearMemberScopedState clears every store and absorbs failures', async () => {
  const rec = recorder();
  await clearMemberScopedState({
    clearQueries: () => void rec.calls.push('clearQueries'),
    clearLists: () => void rec.calls.push('clearLists'),
    resetReads: () => void rec.calls.push('resetReads'),
    clearSnapshot: async () => {
      rec.calls.push('clearSnapshot');
      throw new Error('down');
    },
    clearCaches: async () => void rec.calls.push('clearCaches'),
  });

  assert.deepEqual(rec.calls, [
    'clearQueries',
    'clearLists',
    'resetReads',
    'clearSnapshot',
    'clearCaches',
  ]);
});

test('offline logout still clears local state and signs out first', async () => {
  const calls: string[] = [];
  const steps: LogoutSteps = {
    invalidateSession: () => void calls.push('invalidateSession'),
    resetRealtime: () => void calls.push('resetRealtime'),
    markSignedOut: () => void calls.push('markSignedOut'),
    unregisterPush: async () => {
      calls.push('unregisterPush');
      throw new Error('offline');
    },
    logoutRequest: async () => {
      calls.push('logoutRequest');
      throw new Error('offline');
    },
    clearSession: async () => {
      calls.push('clearSession');
      throw new Error('offline');
    },
    clearMemberState: async () => void calls.push('clearMemberState'),
  };

  await performLogout(steps);

  assert.deepEqual(calls, [
    'invalidateSession',
    'resetRealtime',
    'markSignedOut',
    'unregisterPush',
    'logoutRequest',
    'clearSession',
    'clearMemberState',
  ]);
});

test('a hanging logout request cannot block local teardown or a re-login', async () => {
  const calls: string[] = [];
  const never = new Promise<void>(() => {});
  const steps: LogoutSteps = {
    invalidateSession: () => void calls.push('invalidateSession'),
    resetRealtime: () => void calls.push('resetRealtime'),
    markSignedOut: () => void calls.push('markSignedOut'),
    unregisterPush: async () => void calls.push('unregisterPush'),
    logoutRequest: () => {
      calls.push('logoutRequest');
      return never;
    },
    clearSession: async () => void calls.push('clearSession'),
    clearMemberState: async () => void calls.push('clearMemberState'),
  };

  await performLogout(steps, { timeouts: { logoutRequest: 10 } });
  assert.deepEqual(calls, [
    'invalidateSession',
    'resetRealtime',
    'markSignedOut',
    'unregisterPush',
    'logoutRequest',
    'clearSession',
    'clearMemberState',
  ]);
});

test('settleWithin resolves with the step or the timeout', async () => {
  let resolved = false;
  await settleWithin(Promise.resolve(), 100);
  await settleWithin(
    new Promise<void>((resolve) => {
      setTimeout(() => {
        resolved = true;
        resolve();
      }, 50);
    }),
    100,
  );
  assert.equal(resolved, true);
  await settleWithin(new Promise<void>(() => {}), 5);
});

test('a hung storage teardown cannot hold logout or re-login forever', async () => {
  const calls: string[] = [];
  const never = new Promise<void>(() => {});
  const steps: LogoutSteps = {
    invalidateSession: () => void calls.push('invalidateSession'),
    resetRealtime: () => void calls.push('resetRealtime'),
    markSignedOut: () => void calls.push('markSignedOut'),
    unregisterPush: async () => void calls.push('unregisterPush'),
    logoutRequest: async () => void calls.push('logoutRequest'),
    clearSession: async () => void calls.push('clearSession'),
    clearMemberState: () => {
      calls.push('clearMemberState');
      return never;
    },
  };

  await performLogout(steps, { timeouts: { clearMemberState: 10 } });
  assert.deepEqual(calls, [
    'invalidateSession',
    'resetRealtime',
    'markSignedOut',
    'unregisterPush',
    'logoutRequest',
    'clearSession',
    'clearMemberState',
  ]);
});
