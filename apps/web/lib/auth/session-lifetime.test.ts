import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_SESSION_EXPIRY_SECONDS,
  SESSION_RENEWAL_WINDOW_SECONDS,
  USER_SESSION_EXPIRY_SECONDS,
  sessionExpirySeconds,
  shouldRenewSession,
} from "./session-lifetime";

test("member sessions are long-lived while admin sessions stay short", () => {
  assert.equal(sessionExpirySeconds("user"), USER_SESSION_EXPIRY_SECONDS);
  assert.equal(sessionExpirySeconds("admin"), ADMIN_SESSION_EXPIRY_SECONDS);
  assert.equal(USER_SESSION_EXPIRY_SECONDS, 60 * 60 * 24 * 365);
  assert.equal(ADMIN_SESSION_EXPIRY_SECONDS, 60 * 60 * 24 * 7);
  // Browsers cap a cookie's max-age at 400 days.
  assert.ok(USER_SESSION_EXPIRY_SECONDS < 400 * 24 * 60 * 60);
});

test("a live session renews only inside its final month", () => {
  const now = 1_700_000_000;
  assert.equal(shouldRenewSession(now + SESSION_RENEWAL_WINDOW_SECONDS + 1, now), false);
  assert.equal(shouldRenewSession(now + SESSION_RENEWAL_WINDOW_SECONDS, now), true);
  assert.equal(shouldRenewSession(now + 60, now), true);
  assert.equal(shouldRenewSession(undefined, now), false);
});
