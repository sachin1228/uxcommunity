/**
 * Profile endpoint stress tests.
 *
 * Endpoints covered:
 *   GET   /api/profile
 *   PATCH /api/profile
 *   POST  /api/profile/interests
 *   GET   /api/profile/threads
 *   GET   /api/lottie-settings
 *   GET   /api/link-preview?url=...
 *
 * Requires: authenticated user session.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';
import { objectResponse } from '../utils/checks.js';

export function profileTests() {
  group('profile — get', () => {
    const res = http.get(`${BASE_URL}/api/profile`, {
      tags: { name: 'profile/get' },
    });
    // Response shape: { user: { name, email, ... }, profile: { avatar_url, ... }, ... }
    check(res, {
      'profile/get: status 200': (r) => r.status === 200,
      'profile/get: has user object': (r) => {
        try {
          const b = JSON.parse(r.body);
          return b.user !== null && typeof b.user === 'object';
        } catch { return false; }
      },
      'profile/get: has profile object': (r) => {
        try {
          const b = JSON.parse(r.body);
          return b.profile !== null && typeof b.profile === 'object';
        } catch { return false; }
      },
    });
    sleep(0.1);
  });

  group('profile — patch (update bio)', () => {
    const res = http.patch(
      `${BASE_URL}/api/profile`,
      JSON.stringify({
        bio: `k6 stress test bio — VU ${__VU}, iteration ${__ITER}`,
      }),
      { headers: JSON_HEADERS, tags: { name: 'profile/patch' } },
    );
    check(res, {
      'profile/patch: status 200': (r) => r.status === 200,
    });
    sleep(0.2);
  });

  group('profile — update interests (empty list is valid)', () => {
    const res = http.post(
      `${BASE_URL}/api/profile/interests`,
      JSON.stringify({ interest_ids: [] }),
      { headers: JSON_HEADERS, tags: { name: 'profile/interests' } },
    );
    check(res, {
      'profile/interests: status 2xx': (r) =>
        r.status >= 200 && r.status < 300,
    });
    sleep(0.1);
  });

  group('profile — threads list', () => {
    const res = http.get(`${BASE_URL}/api/profile/threads`, {
      tags: { name: 'profile/threads' },
    });
    check(res, {
      'profile/threads: status 200': (r) => r.status === 200,
    });
    sleep(0.1);
  });

  group('lottie-settings — get', () => {
    const res = http.get(`${BASE_URL}/api/lottie-settings`, {
      tags: { name: 'lottie-settings/get' },
    });
    check(res, {
      'lottie-settings/get: status 200': (r) => r.status === 200,
    });
    sleep(0.1);
  });

  group('link-preview — fetch preview', () => {
    const res = http.get(
      `${BASE_URL}/api/link-preview?url=https://example.com`,
      { tags: { name: 'link-preview/get' } },
    );
    check(res, {
      'link-preview/get: status 200 or 4xx': (r) =>
        r.status === 200 || (r.status >= 400 && r.status < 500),
    });
    sleep(0.3);
  });
}
