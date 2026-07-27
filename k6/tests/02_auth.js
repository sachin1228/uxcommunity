/**
 * Auth endpoint tests.
 *
 * authTests() — runs while a user session is already active (managed by the
 *               calling scenario). Tests /me, invalid login, and reset-request.
 *               Does NOT call loginUser() or logout() — the scenario owns that.
 *
 * authStandaloneTests() — self-contained login + logout cycle for smoke use.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';

const USER_EMAIL    = __ENV.TEST_USER_EMAIL    || 'testuser@example.com';
const USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'password123';

/** Expects an active session to already exist. */
export function authTests() {
  group('auth — me (authenticated)', () => {
    const res = http.get(`${BASE_URL}/api/auth/me`, {
      tags: { name: 'auth/me-authed' },
    });
    check(res, {
      'auth/me authed: status 200': (r) => r.status === 200,
      'auth/me authed: user present': (r) => {
        try { return !!JSON.parse(r.body).user; } catch { return false; }
      },
    });
    sleep(0.1);
  });

  group('auth — login with invalid credentials', () => {
    const res = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: 'nobody@example.com', password: 'wrongpass' }),
      { headers: JSON_HEADERS, tags: { name: 'auth/login-invalid' } },
    );
    // 401 = bad creds, 400/422 = validation, 429 = rate limited (expected under load)
    check(res, {
      'auth/login invalid: status 401 or 400 or 422 or 429': (r) =>
        r.status === 401 || r.status === 400 || r.status === 422 || r.status === 429,
    });
    sleep(0.2);
  });

  group('auth — reset password request', () => {
    // Non-existent email — server should return 200 (no user enumeration)
    const res = http.post(
      `${BASE_URL}/api/auth/reset-request`,
      JSON.stringify({ email: 'nobody@example.com' }),
      { headers: JSON_HEADERS, tags: { name: 'auth/reset-request' } },
    );
    check(res, {
      'auth/reset-request: status 200 or 429': (r) =>
        r.status === 200 || r.status === 429,
    });
    sleep(0.3);
  });

  group('auth — me (unauthenticated — separate cookie jar)', () => {
    // Create a fresh, isolated jar so no session cookie is sent
    const jar = new http.CookieJar();
    const res = http.get(`${BASE_URL}/api/auth/me`, {
      tags: { name: 'auth/me-unauthed' },
      jar,
    });
    check(res, {
      'auth/me unauthed: status 200': (r) => r.status === 200,
      'auth/me unauthed: no active user': (r) => {
        try {
          const b = JSON.parse(r.body);
          // Either user is null, or the response has no user key at all
          return b.user === null || b.user === undefined;
        } catch { return false; }
      },
    });
    sleep(0.1);
  });
}
