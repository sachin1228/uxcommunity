import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOKEN_EVENT_COOLDOWN_MS,
  isNewDeviceToken,
  shouldHandleTokenEvent,
  shouldRetryPushRegistrationOnForeground,
} from './pushRegistrationGate';

test('a token event is ignored while a registration is in flight', () => {
  assert.equal(
    shouldHandleTokenEvent({
      now: 1_000_000,
      inFlight: true,
      lastRegistrationAt: 0,
    }),
    false,
  );
});

test('the echo from our own registration does not start another one', () => {
  // Expo emits a token event when the registration reads the device token;
  // without the cooldown those events re-enter registration forever.
  const registeredAt = 1_000_000;
  assert.equal(
    shouldHandleTokenEvent({
      now: registeredAt + 1,
      inFlight: false,
      lastRegistrationAt: registeredAt,
    }),
    false,
  );
  assert.equal(
    shouldHandleTokenEvent({
      now: registeredAt + TOKEN_EVENT_COOLDOWN_MS - 1,
      inFlight: false,
      lastRegistrationAt: registeredAt,
    }),
    false,
  );
});

test('a genuine rotation after the cooldown is honoured', () => {
  const registeredAt = 1_000_000;
  assert.equal(
    shouldHandleTokenEvent({
      now: registeredAt + TOKEN_EVENT_COOLDOWN_MS,
      inFlight: false,
      lastRegistrationAt: registeredAt,
    }),
    true,
  );
});

test('the echo of our own device-token read is not a rotation', () => {
  assert.equal(isNewDeviceToken('fcm-a', 'fcm-a'), false);
  assert.equal(isNewDeviceToken('fcm-a', null), false);
  assert.equal(isNewDeviceToken('fcm-a', 42), false);
});

test('a changed device token bypasses the cooldown decision', () => {
  assert.equal(isNewDeviceToken('fcm-a', 'fcm-b'), true);
  assert.equal(isNewDeviceToken(null, 'fcm-a'), true);
  assert.equal(isNewDeviceToken('fcm-a', ''), false);
});


test('only transient registration errors retry on foreground', () => {
  assert.equal(shouldRetryPushRegistrationOnForeground('error', true), true);
  assert.equal(shouldRetryPushRegistrationOnForeground('error', false), false);
  assert.equal(shouldRetryPushRegistrationOnForeground('denied', true), false);
  assert.equal(shouldRetryPushRegistrationOnForeground('registered', false), false);
  assert.equal(shouldRetryPushRegistrationOnForeground('registering', false), false);
});
