import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOKEN_EVENT_COOLDOWN_MS,
  shouldHandleTokenEvent,
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
