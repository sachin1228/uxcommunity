import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushRotationFollowUp } from './pushRotationFollowUp';

test('a rotation with no registration in flight runs immediately', () => {
  let runs = 0;
  const followUp = createPushRotationFollowUp(() => true);
  followUp.schedule(null, () => {
    runs += 1;
  });
  assert.equal(runs, 1);
  assert.equal(followUp.isQueued(), false);
});

test('a rotation during an in-flight registration runs once after it settles', async () => {
  let resolve: () => void = () => {};
  const inFlight = new Promise<void>((done) => {
    resolve = done;
  });
  let runs = 0;
  const followUp = createPushRotationFollowUp(() => true);

  followUp.schedule(inFlight, () => {
    runs += 1;
  });
  followUp.schedule(inFlight, () => {
    runs += 1;
  });
  assert.equal(followUp.isQueued(), true);
  assert.equal(runs, 0);

  resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(followUp.isQueued(), false);

  // A later rotation can queue a new follow-up.
  followUp.schedule(inFlight, () => {
    runs += 1;
  });
  assert.equal(followUp.isQueued(), true);
});

test('an in-flight registration that rejects still schedules the newest token', async () => {
  const inFlight = Promise.reject(new Error('network')); // handled by the follow-up
  let runs = 0;
  const followUp = createPushRotationFollowUp(() => true);

  followUp.schedule(inFlight, () => {
    runs += 1;
  });
  await inFlight.catch(() => {});
  await Promise.resolve();
  assert.equal(runs, 1);
});

test('a rotation that settles after sign-out does not register', async () => {
  let resolve: () => void = () => {};
  const inFlight = new Promise<void>((done) => {
    resolve = done;
  });
  let signedIn = true;
  let runs = 0;
  const followUp = createPushRotationFollowUp(() => signedIn);

  followUp.schedule(inFlight, () => {
    runs += 1;
  });
  signedIn = false; // sign-out before the old registration settles
  resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runs, 0);
});

import {
  createPushRegistrationCoordinator,
  type PushTokenPair,
} from './pushRegistrationCoordinator';

test('token B registered during token A registration is posted after A settles', async () => {
  let resolveA: (pair: PushTokenPair) => void = () => {};
  const aToken = new Promise<PushTokenPair>((resolve) => {
    resolveA = resolve;
  });
  let acquisitions = 0;
  let resolveBPosted: () => void = () => {};
  const bPosted = new Promise<void>((resolve) => {
    resolveBPosted = resolve;
  });
  const posted: string[] = [];

  const coordinator = createPushRegistrationCoordinator({
    acquire: async () => {
      acquisitions += 1;
      return acquisitions === 1 ? aToken : { token: 'expo-b', fcmToken: 'fcm-b' };
    },
    post: async (pair) => {
      posted.push(pair.token);
      if (pair.token === 'expo-b') resolveBPosted();
    },
  });

  let followUp = false;
  let second: Promise<string | null> | null = null;
  const rotation = createPushRotationFollowUp(() => true);
  const first = coordinator.register();
  rotation.schedule(first, () => {
    followUp = true;
    second = coordinator.register();
  });

  resolveA({ token: 'expo-a', fcmToken: 'fcm-a' });
  await first;
  assert.ok(second);
  await second;
  await bPosted;
  assert.equal(followUp, true);
  assert.deepEqual(posted, ['expo-a', 'expo-b']);
  assert.equal(coordinator.registeredSignature(), 'expo-b|fcm-b');
});
