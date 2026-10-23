import assert from 'node:assert/strict';
import test from 'node:test';

import { withTimeout, timedOutMessage } from './withTimeout';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a call that finishes in time settles with its value', async () => {
  assert.equal(await withTimeout(Promise.resolve('token'), 50, 'too slow'), 'token');
});

test('a call that never settles is rejected at the deadline', async () => {
  const never = new Promise<string>(() => {});
  await assert.rejects(
    withTimeout(never, 10, timedOutMessage(10)),
    /timed out after 0\.01s/,
  );
});

test('a call that fails fast keeps its own error', async () => {
  await assert.rejects(
    withTimeout(Promise.reject(new Error('Default FirebaseApp is not initialized')), 50, 'ignored'),
    /Default FirebaseApp is not initialized/,
  );
});

test('a rejection that lands after the deadline does not surface twice', async () => {
  const pending = deferred<string>();
  const run = withTimeout(pending.promise, 5, 'deadline');
  await assert.rejects(run, /deadline/);
  // The abandoned promise settling late must not throw out of the helper.
  pending.reject(new Error('late failure'));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
