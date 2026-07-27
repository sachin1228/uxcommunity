/**
 * Stress test — spikes to 200 VUs to find the application's breaking point.
 *
 * Deliberately exceeds expected peak load. The goal is to identify where
 * response times degrade and error rates climb, not to pass every threshold.
 *
 * This test focuses on the highest-traffic paths:
 *   - Public data reads (no DB auth overhead)
 *   - Login (rate-limited — reveals limiter behaviour under pressure)
 *   - Community message reads
 *   - Thread listing
 *
 * Usage:
 *   k6 run k6/scenarios/stress.js \
 *     -e BASE_URL=http://localhost:3000 \
 *     -e TEST_USER_EMAIL=member@example.com \
 *     -e TEST_USER_PASSWORD=secret \
 *     -e TEST_COMMUNITY_ID=<uuid>
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { STRESS_OPTIONS, BASE_URL, JSON_HEADERS } from '../config.js';
import { loginUser, logout } from '../utils/auth.js';
import { publicDataTests } from '../tests/01_public_data.js';
import { communityTests } from '../tests/04_communities.js';
import { threadTests } from '../tests/05_threads.js';

export const options = STRESS_OPTIONS;

const USER_EMAIL    = __ENV.TEST_USER_EMAIL    || 'testuser@example.com';
const USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'password123';

export default function () {
  // ── High-frequency read paths ──────────────────────────────────────────────
  publicDataTests();

  // ── Auth (rate-limiter pressure) ───────────────────────────────────────────
  loginUser(USER_EMAIL, USER_PASSWORD);

  // ── Authenticated reads ────────────────────────────────────────────────────
  communityTests();
  threadTests();

  logout();

  // No think-time — maximum concurrency pressure
  sleep(0.1);
}
