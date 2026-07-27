/**
 * Admin endpoint stress tests.
 *
 * Endpoints covered (read-only paths only — no destructive mutations):
 *   GET /api/admin/applications
 *   GET /api/admin/users
 *   GET /api/admin/communities
 *   GET /api/admin/cities
 *   GET /api/admin/sectors
 *   GET /api/admin/companies
 *   GET /api/admin/interests
 *   GET /api/admin/moderation
 *   GET /api/admin/tags
 *
 * Write paths (create city/sector/company/interest) are exercised once in the
 * smoke test only to avoid polluting the database during high-VU runs.
 *
 * Requires: authenticated admin session. Call loginAdmin() before running.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';

const READ_ENDPOINTS = [
  { name: 'admin/applications',  path: '/api/admin/applications?page=1' },
  { name: 'admin/users',         path: '/api/admin/users?page=1' },
  { name: 'admin/communities',   path: '/api/admin/communities' },
  { name: 'admin/cities',        path: '/api/admin/cities' },
  { name: 'admin/sectors',       path: '/api/admin/sectors' },
  { name: 'admin/companies',     path: '/api/admin/companies' },
  { name: 'admin/interests',     path: '/api/admin/interests' },
  { name: 'admin/moderation',    path: '/api/admin/moderation?status=pending&page=1' },
  { name: 'admin/tags',          path: '/api/admin/tags' },
];

export function adminReadTests() {
  group('admin — read-only endpoints', () => {
    for (const ep of READ_ENDPOINTS) {
      group(ep.name, () => {
        const res = http.get(`${BASE_URL}${ep.path}`, {
          tags: { name: ep.name },
        });
        check(res, {
          [`${ep.name}: status 200 or 401`]: (r) =>
            r.status === 200 || r.status === 401 || r.status === 403,
        });
        sleep(0.05);
      });
    }
  });
}

/**
 * Light write smoke for admin master-data endpoints.
 * Only call this from the smoke scenario (1 VU, 1 iteration).
 */
export function adminWriteSmoke() {
  group('admin — create city (smoke only)', () => {
    const res = http.post(
      `${BASE_URL}/api/admin/cities`,
      JSON.stringify({ name: `k6 smoke city ${Date.now()}` }),
      { headers: JSON_HEADERS, tags: { name: 'admin/cities-post' } },
    );
    check(res, {
      'admin/cities-post: status 2xx or 401': (r) =>
        (r.status >= 200 && r.status < 300) || r.status === 401 || r.status === 403,
    });
    sleep(0.2);
  });

  group('admin — create interest (smoke only)', () => {
    const res = http.post(
      `${BASE_URL}/api/admin/interests`,
      JSON.stringify({ name: `k6 smoke interest ${Date.now()}` }),
      { headers: JSON_HEADERS, tags: { name: 'admin/interests-post' } },
    );
    check(res, {
      'admin/interests-post: status 2xx or 401': (r) =>
        (r.status >= 200 && r.status < 300) || r.status === 401 || r.status === 403,
    });
    sleep(0.2);
  });
}

/** Test that non-admin sessions are rejected from admin routes */
export function adminAuthGuardTests() {
  group('admin — guard: unauthenticated access should be denied', () => {
    const res = http.get(`${BASE_URL}/api/admin/users`, {
      tags: { name: 'admin/guard-unauthed' },
    });
    check(res, {
      'admin/guard: 401 or 403': (r) =>
        r.status === 401 || r.status === 403,
    });
    sleep(0.1);
  });
}
