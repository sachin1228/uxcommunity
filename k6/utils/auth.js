/**
 * Authentication helpers for k6 tests.
 *
 * Sessions are stored in httpOnly cookies managed automatically by k6's
 * cookie jar — no manual token handling needed.
 */

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';

/**
 * Log in as a regular (member) user.
 * Returns the HTTP response; the session cookie is set on the shared jar.
 *
 * @param {string} email
 * @param {string} password
 * @returns {import('k6/http').Response}
 */
export function loginUser(email, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: JSON_HEADERS, tags: { name: 'auth/login' } },
  );
  check(res, {
    // 429 means rate-limited — valid outcome under load, not a failure
    'login: status 200 or 429': (r) => r.status === 200 || r.status === 429,
    'login: success true (when not rate-limited)': (r) => {
      if (r.status === 429) return true;
      try { return JSON.parse(r.body).success === true; } catch { return false; }
    },
  });
  return res;
}

/**
 * Log in as the admin user.
 *
 * @param {string} email
 * @param {string} password
 * @returns {import('k6/http').Response}
 */
export function loginAdmin(email, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: JSON_HEADERS, tags: { name: 'auth/login-admin' } },
  );
  check(res, {
    'admin login: status 200 or 429': (r) => r.status === 200 || r.status === 429,
    'admin login: success true (when not rate-limited)': (r) => {
      if (r.status === 429) return true;
      try { return JSON.parse(r.body).success === true; } catch { return false; }
    },
  });
  return res;
}

/**
 * Log out the currently authenticated user.
 *
 * @returns {import('k6/http').Response}
 */
export function logout() {
  const res = http.post(
    `${BASE_URL}/api/auth/logout`,
    null,
    { headers: JSON_HEADERS, tags: { name: 'auth/logout' } },
  );
  check(res, {
    'logout: status 200': (r) => r.status === 200,
  });
  return res;
}
