import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPresentPush } from './pushPresentation';

test('a signed-out device suppresses every push', () => {
  assert.equal(shouldPresentPush({ signedIn: false, muted: false, alreadyReading: false }), false);
  assert.equal(shouldPresentPush({ signedIn: false, muted: true, alreadyReading: true }), false);
});

test('mute and the active chat still suppress a signed-in push', () => {
  assert.equal(shouldPresentPush({ signedIn: true, muted: true, alreadyReading: false }), false);
  assert.equal(shouldPresentPush({ signedIn: true, muted: false, alreadyReading: true }), false);
});

test('a normal signed-in push is presented', () => {
  assert.equal(shouldPresentPush({ signedIn: true, muted: false, alreadyReading: false }), true);
});
