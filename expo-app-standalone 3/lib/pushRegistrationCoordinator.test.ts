import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPushRegistrationCoordinator,
  type PushTokenPair,
} from './pushRegistrationCoordinator';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tokens = (token: string, fcmToken: string | null = 'fcm-a'): PushTokenPair => ({
  token,
  fcmToken,
});

test('repeated token events with the same pair post exactly once', async () => {
  let acquired = 0;
  let posted = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => {
      acquired += 1;
      return tokens('expo-a');
    },
    post: async () => {
      posted += 1;
    },
  });

  for (let i = 0; i < 100; i += 1) {
    assert.equal(await coordinator.register(), 'expo-a');
  }
  assert.equal(acquired, 100);
  assert.equal(posted, 1);
  assert.equal(coordinator.registeredSignature(), 'expo-a|fcm-a');
});

test('a skipped repeat reports the pair so the caller can settle on registered', async () => {
  let posted = 0;
  const skipped: PushTokenPair[] = [];
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => tokens('expo-a'),
    post: async () => {
      posted += 1;
    },
    onAlreadyRegistered: async (pair) => {
      skipped.push(pair);
    },
  });

  await coordinator.register();
  await coordinator.register();
  await coordinator.register();

  // Only the repeats are reported; the first registration was a real POST.
  assert.equal(posted, 1);
  assert.deepEqual(skipped, [tokens('expo-a'), tokens('expo-a')]);
});

test('a pair is only reported as already registered after a successful post', async () => {
  let attempts = 0;
  const skipped: string[] = [];
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => tokens('expo-a'),
    post: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network down');
    },
    onAlreadyRegistered: ({ token }) => {
      skipped.push(token);
    },
  });

  await assert.rejects(coordinator.register(), /network down/);
  // Nothing was posted, so this attempt must post rather than skip.
  await coordinator.register();
  await coordinator.register();

  assert.deepEqual(skipped, ['expo-a']);
});

test('concurrent callers share one acquire and one post', async () => {
  const pending = deferred<PushTokenPair | null>();
  let acquired = 0;
  let posted = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: () => {
      acquired += 1;
      return pending.promise;
    },
    post: async () => {
      posted += 1;
    },
  });

  const first = coordinator.register();
  const second = coordinator.register();
  const third = coordinator.register();
  assert.equal(acquired, 1);
  assert.equal(coordinator.isInFlight(), true);

  pending.resolve(tokens('expo-a'));
  assert.deepEqual(await Promise.all([first, second, third]), [
    'expo-a',
    'expo-a',
    'expo-a',
  ]);
  assert.equal(posted, 1);
});

test('a genuinely rotated device token is posted', async () => {
  let token = 'expo-a';
  let posted = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => tokens(token),
    post: async () => {
      posted += 1;
    },
  });

  await coordinator.register();
  token = 'expo-b';
  await coordinator.register();

  assert.equal(posted, 2);
  assert.equal(coordinator.registeredSignature(), 'expo-b|fcm-a');
});

test('a changed FCM token alone is posted', async () => {
  let fcm = 'fcm-a';
  let posted = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => tokens('expo-a', fcm),
    post: async () => {
      posted += 1;
    },
  });

  await coordinator.register();
  fcm = 'fcm-b';
  await coordinator.register();
  assert.equal(posted, 2);
});

test('sign-out abandons a token read that finishes late', async () => {
  const oldAcquire = deferred<PushTokenPair | null>();
  const newAcquire = deferred<PushTokenPair | null>();
  const acquisitions = [oldAcquire, newAcquire];
  let index = 0;
  const posted: string[] = [];

  const coordinator = createPushRegistrationCoordinator({
    acquire: () => acquisitions[index++].promise,
    post: async (pair) => {
      posted.push(pair.token);
    },
  });

  const oldRun = coordinator.register();
  coordinator.reset(); // sign-out
  const newRun = coordinator.register(); // next session

  oldAcquire.resolve(tokens('expo-old'));
  assert.equal(await oldRun, null);
  assert.deepEqual(posted, []);

  newAcquire.resolve(tokens('expo-new'));
  assert.equal(await newRun, 'expo-new');
  assert.deepEqual(posted, ['expo-new']);
});

test('a post that belongs to the old account is not recorded after a switch', async () => {
  const firstPost = deferred<void>();
  const firstPostStarted = deferred<void>();
  const posted: string[] = [];
  let attempt = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => {
      const token = attempt === 0 ? 'expo-a' : 'expo-b';
      attempt += 1;
      return tokens(token);
    },
    post: async (pair) => {
      posted.push(pair.token);
      if (pair.token === 'expo-a') {
        firstPostStarted.resolve();
        await firstPost.promise;
      }
    },
  });

  const oldRun = coordinator.register();
  // The old account's POST is genuinely in flight when the switch happens.
  await firstPostStarted.promise;
  coordinator.reset();

  const newRun = coordinator.register();
  firstPost.resolve();
  assert.equal(await oldRun, null);
  assert.equal(await newRun, 'expo-b');
  assert.deepEqual(posted, ['expo-a', 'expo-b']);
  assert.equal(coordinator.registeredSignature(), 'expo-b|fcm-a');
});

test('signing back in with the same device token posts it again', async () => {
  let posted = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => tokens('expo-a'),
    post: async () => {
      posted += 1;
    },
  });

  await coordinator.register();
  coordinator.reset(); // account switch
  await coordinator.register();
  assert.equal(posted, 2);
});

test('a failed post is not recorded and a deliberate retry works', async () => {
  let attempts = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => tokens('expo-a'),
    post: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network down');
    },
  });

  await assert.rejects(coordinator.register(), /network down/);
  assert.equal(coordinator.registeredSignature(), null);
  assert.equal(await coordinator.register(), 'expo-a');
  assert.equal(attempts, 2);
});

test('a denied acquire resolves null without a post', async () => {
  let posted = 0;
  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => null,
    post: async () => {
      posted += 1;
    },
  });

  assert.equal(await coordinator.register(), null);
  assert.equal(posted, 0);
  assert.equal(coordinator.isInFlight(), false);
});

test('pending exposes the in-flight registration and reset drops it', async () => {
  const pending = deferred<PushTokenPair | null>();
  const coordinator = createPushRegistrationCoordinator({
    acquire: () => pending.promise,
    post: async () => {},
  });

  const run = coordinator.register();
  assert.equal(coordinator.pending(), run);
  coordinator.reset();
  assert.equal(coordinator.pending(), null);
  pending.resolve(tokens('expo-a'));
  assert.equal(await run, null);
});
