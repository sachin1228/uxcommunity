/**
 * Public data endpoints — no authentication required.
 *
 * Endpoints covered:
 *   GET /api/data/cities            → { cities: [] }
 *   GET /api/data/companies         → { companies: [] }
 *   GET /api/data/sectors           → { sectors: [] }
 *   GET /api/data/interests         → { interests: [] }
 *   GET /api/data/experience-levels → { experience_levels: [] }
 *   GET /api/giphy?type=trending&limit=10
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL } from '../config.js';

// Each endpoint returns a wrapped object { <key>: [] } — not a raw array.
const ENDPOINTS = [
  { name: 'cities',             path: '/api/data/cities',             key: 'cities' },
  { name: 'companies',          path: '/api/data/companies',          key: 'companies' },
  { name: 'sectors',            path: '/api/data/sectors',            key: 'sectors' },
  { name: 'interests',          path: '/api/data/interests',          key: 'interests' },
  { name: 'experience-levels',  path: '/api/data/experience-levels',  key: 'experience_levels' },
];

export function publicDataTests() {
  group('public data — reference lists', () => {
    for (const ep of ENDPOINTS) {
      group(ep.name, () => {
        const res = http.get(`${BASE_URL}${ep.path}`, {
          tags: { name: `data/${ep.name}` },
        });
        check(res, {
          [`data/${ep.name}: status 200`]: (r) => r.status === 200,
          [`data/${ep.name}: body has ${ep.key} array`]: (r) => {
            try {
              const b = JSON.parse(r.body);
              return Array.isArray(b[ep.key]);
            } catch { return false; }
          },
        });
        sleep(0.1);
      });
    }
  });

  group('giphy — trending', () => {
    const res = http.get(`${BASE_URL}/api/giphy?type=trending&limit=10`, {
      tags: { name: 'giphy/trending' },
    });
    // 200 = ok, 429 = rate limited, 503 = GIPHY_API_KEY not configured, 502 = GIPHY unreachable
    check(res, {
      'giphy/trending: status 200 or 429 or 502 or 503': (r) =>
        r.status === 200 || r.status === 429 || r.status === 502 || r.status === 503,
    });
    sleep(0.1);
  });

  group('giphy — search', () => {
    const res = http.get(`${BASE_URL}/api/giphy?type=search&q=design&limit=10`, {
      tags: { name: 'giphy/search' },
    });
    check(res, {
      'giphy/search: status 200 or 429 or 502 or 503': (r) =>
        r.status === 200 || r.status === 429 || r.status === 502 || r.status === 503,
    });
    sleep(0.1);
  });
}
