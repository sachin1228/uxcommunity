/**
 * Soak test — 20 VUs held for 30 minutes.
 *
 * Detects resource leaks, connection pool exhaustion, and memory growth that
 * only surface under extended load. Run this overnight or as part of a weekly
 * CI/CD check.
 *
 * Usage:
 *   k6 run k6/scenarios/soak.js \
 *     -e BASE_URL=http://localhost:3000 \
 *     -e TEST_USER_EMAIL=member@example.com \
 *     -e TEST_USER_PASSWORD=secret \
 *     -e TEST_COMMUNITY_ID=<uuid>
 */

import { sleep } from 'k6';
import { SOAK_OPTIONS } from '../config.js';
import { loginUser, logout } from '../utils/auth.js';
import { publicDataTests } from '../tests/01_public_data.js';
import { communityTests } from '../tests/04_communities.js';
import { threadTests } from '../tests/05_threads.js';
import { profileTests } from '../tests/07_profile.js';

export const options = SOAK_OPTIONS;

const USER_EMAIL    = __ENV.TEST_USER_EMAIL    || 'testuser@example.com';
const USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'password123';

export default function () {
  publicDataTests();

  loginUser(USER_EMAIL, USER_PASSWORD);

  communityTests();
  threadTests();
  profileTests();

  logout();

  sleep(2);
}
