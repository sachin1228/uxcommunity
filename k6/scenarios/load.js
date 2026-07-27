/**
 * Load test — ramps to 50 concurrent VUs and holds for 5 minutes.
 *
 * Models realistic sustained production traffic. Each VU logs in once,
 * exercises the core read-heavy paths (public data, communities, threads,
 * events, profile), then logs out.
 *
 * Recommended thresholds (defined in config.js):
 *   p(95) < 2 000 ms
 *   p(99) < 5 000 ms
 *   error rate < 5 %
 *
 * Usage:
 *   k6 run k6/scenarios/load.js \
 *     -e BASE_URL=http://localhost:3000 \
 *     -e TEST_USER_EMAIL=member@example.com \
 *     -e TEST_USER_PASSWORD=secret \
 *     -e TEST_COMMUNITY_ID=<uuid>
 *
 * To also exercise admin routes, add:
 *     -e ADMIN_EMAIL=admin@example.com \
 *     -e ADMIN_PASSWORD=secret
 */

import { sleep } from 'k6';
import { LOAD_OPTIONS } from '../config.js';
import { loginUser, logout } from '../utils/auth.js';
import { publicDataTests } from '../tests/01_public_data.js';
import { communityTests } from '../tests/04_communities.js';
import { threadTests } from '../tests/05_threads.js';
import { eventTests } from '../tests/06_events.js';
import { profileTests } from '../tests/07_profile.js';

export const options = LOAD_OPTIONS;

const USER_EMAIL    = __ENV.TEST_USER_EMAIL    || 'testuser@example.com';
const USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'password123';

export default function () {
  // Public data — no session needed
  publicDataTests();

  // Authenticated member paths
  loginUser(USER_EMAIL, USER_PASSWORD);

  communityTests();
  threadTests();
  eventTests();
  profileTests();

  logout();

  // Brief think-time between iterations
  sleep(1);
}
