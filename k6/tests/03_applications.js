/**
 * Application submission endpoint stress tests.
 *
 * Endpoints covered:
 *   POST /api/applications
 *
 * Note: Each VU submits a unique fake application to avoid duplicate-email
 * rejection. The server may rate-limit; 429 responses are treated as passing
 * (the limiter is working as intended).
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';

export function applicationTests() {
  group('applications — submit (unique per VU+iter)', () => {
    const uniqueId = `${__VU}_${__ITER}_${Date.now()}`;
    const payload  = {
      name:          `Test User ${uniqueId}`,
      email:         `testapp_${uniqueId}@k6test.invalid`,
      linkedin_url:  `https://linkedin.com/in/testuser-${uniqueId}`,
      portfolio_url: `https://portfolio-${uniqueId}.example.com`,
    };

    const res = http.post(
      `${BASE_URL}/api/applications`,
      JSON.stringify(payload),
      { headers: JSON_HEADERS, tags: { name: 'applications/submit' } },
    );

    check(res, {
      'applications/submit: accepted or rate-limited': (r) =>
        r.status === 200 || r.status === 201 || r.status === 429,
    });
    sleep(0.5);
  });

  group('applications — submit with missing fields (validation)', () => {
    const res = http.post(
      `${BASE_URL}/api/applications`,
      JSON.stringify({ name: 'Incomplete' }), // missing email etc.
      { headers: JSON_HEADERS, tags: { name: 'applications/submit-invalid' } },
    );
    check(res, {
      'applications/submit invalid: status 400 or 422': (r) =>
        r.status === 400 || r.status === 422 || r.status === 429,
    });
    sleep(0.2);
  });
}
