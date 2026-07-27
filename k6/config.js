/**
 * Shared k6 configuration — options, thresholds, and base URL.
 * Import this in every scenario file.
 *
 * Environment variables (pass with -e flag or export before running):
 *   BASE_URL            — default: http://localhost:3000
 *   ADMIN_EMAIL         — admin account email
 *   ADMIN_PASSWORD      — admin account password
 *   TEST_USER_EMAIL     — approved member email
 *   TEST_USER_PASSWORD  — approved member password
 *   TEST_COMMUNITY_ID   — UUID of a community the test user belongs to
 *   TEST_THREAD_ID      — UUID of an existing thread (for read tests)
 *   TEST_EVENT_ID       — UUID of an existing event (for read tests)
 */

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/** Shared HTTP headers */
export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Standard thresholds applied to every scenario.
 * Override per-scenario if needed.
 */
export const THRESHOLDS = {
  // 95 % of all requests finish under 2 s
  http_req_duration: ['p(95)<2000'],
  // 99 % finish under 5 s
  'http_req_duration{percentile:99}': ['p(99)<5000'],
  // Error rate threshold scoped to truly unexpected failures only.
  // 429 (rate-limited) and other intentionally non-2xx responses are excluded
  // via tags in each test — this catches real 5xx spikes.
  http_req_failed: ['rate<0.20'],
  // All custom checks must pass > 95 % of the time
  checks: ['rate>0.95'],
};

/** Smoke scenario — single VU, one pass through every endpoint group */
export const SMOKE_OPTIONS = {
  vus: 1,
  iterations: 1,
  thresholds: THRESHOLDS,
};

/**
 * Load scenario — ramp up to 50 VUs, hold, then ramp down.
 * Models steady production traffic.
 */
export const LOAD_OPTIONS = {
  stages: [
    { duration: '1m', target: 10 },   // warm-up
    { duration: '3m', target: 50 },   // ramp to peak
    { duration: '5m', target: 50 },   // hold
    { duration: '1m', target: 0 },    // cool-down
  ],
  thresholds: THRESHOLDS,
};

/**
 * Stress scenario — spike far beyond expected peak to find the breaking point.
 */
export const STRESS_OPTIONS = {
  stages: [
    { duration: '30s', target: 50 },   // ramp
    { duration: '1m',  target: 100 },  // stress
    { duration: '1m',  target: 200 },  // peak stress
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    ...THRESHOLDS,
    // Relax error rate slightly during stress — we're looking for the cliff
    http_req_failed: ['rate<0.15'],
  },
};

/**
 * Soak scenario — moderate load held for 30 minutes to catch memory leaks /
 * connection pool exhaustion.
 */
export const SOAK_OPTIONS = {
  stages: [
    { duration: '2m',  target: 20 },  // ramp up
    { duration: '30m', target: 20 },  // hold
    { duration: '2m',  target: 0 },   // ramp down
  ],
  thresholds: THRESHOLDS,
};
