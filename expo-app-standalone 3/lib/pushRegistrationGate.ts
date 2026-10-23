/**
 * The token listener's gate. Expo schedules a token event whenever the app
 * reads the device token, so a registration started from that listener would
 * schedule the next one forever; events during a registration or just after
 * one are echoes, not rotations.
 */

export const TOKEN_EVENT_COOLDOWN_MS = 30_000;

export function shouldHandleTokenEvent({
  now,
  inFlight,
  lastRegistrationAt,
}: {
  now: number;
  inFlight: boolean;
  lastRegistrationAt: number;
}): boolean {
  if (inFlight) return false;
  return now - lastRegistrationAt >= TOKEN_EVENT_COOLDOWN_MS;
}

/**
 * A genuine FCM/APNs rotation must not be swallowed by the cooldown above.
 * The event carries the new device token; comparing it with the last token the
 * registration read tells a real rotation apart from the echo our own read
 * produces.
 */
export function isNewDeviceToken(
  observedDeviceToken: string | null,
  eventToken: unknown,
): boolean {
  return (
    typeof eventToken === 'string' &&
    eventToken.length > 0 &&
    eventToken !== observedDeviceToken
  );
}
