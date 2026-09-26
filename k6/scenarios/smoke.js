/**
 * Smoke test — 1 VU, 1 iteration.
 *
 * Runs every endpoint group once to confirm the app is alive and all routes
 * respond with expected status codes. Run this before every load/stress test.
 *
 * Usage:
 *   k6 run k6/scenarios/smoke.js \
 *     -e BASE_URL=https://app.uxcommunity.in \
 *     -e ADMIN_EMAIL=admin@uxcommunity.in \
 *     -e ADMIN_PASSWORD=your-admin-password \
 *     -e TEST_USER_EMAIL=member@example.com \
 *     -e TEST_USER_PASSWORD=your-user-password \
 *     -e TEST_COMMUNITY_ID=<uuid>
 */

import { sleep } from 'k6';
import { SMOKE_OPTIONS } from '../config.js';
import { loginUser, loginAdmin, logout } from '../utils/auth.js';
import { publicDataTests } from '../tests/01_public_data.js';
import { authTests } from '../tests/02_auth.js';
import { applicationTests } from '../tests/03_applications.js';
import { communityTests } from '../tests/04_communities.js';
import { threadTests } from '../tests/05_threads.js';
import { eventTests } from '../tests/06_events.js';
import { profileTests } from '../tests/07_profile.js';
import { adminReadTests, adminWriteSmoke, adminAuthGuardTests } from '../tests/08_admin.js';
import { chatMessageTests } from '../tests/09_chat_messages.js';

export const options = SMOKE_OPTIONS;

// Credentials come from the environment — no account or password is committed
// here (see k6/README.md). Fail before the run instead of logging in with a
// stale default and reporting every authenticated check as a 401.
function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(
      `${name} is not set.\n` +
      '  Export your own k6 test account before running this scenario, e.g.\n' +
      '    export TEST_USER_EMAIL=member@example.com TEST_USER_PASSWORD=...\n' +
      '    export ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=...\n' +
      '  See k6/README.md — credentials are never committed to the repository.',
    );
  }
  return value;
}

const USER_EMAIL     = requiredEnv('TEST_USER_EMAIL');
const USER_PASSWORD  = requiredEnv('TEST_USER_PASSWORD');
const ADMIN_EMAIL    = __ENV.ADMIN_EMAIL         || '';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD      || '';

export default function () {
  // ── 1. Public endpoints — no auth needed ──────────────────────────────────
  publicDataTests();

  // ── 2. Application submission — no auth needed ────────────────────────────
  applicationTests();

  // ── 3. Guard check — admin routes must reject unauthenticated requests ─────
  adminAuthGuardTests();

  // ── 4. Member session ─────────────────────────────────────────────────────
  // Log in once here; authTests() does NOT call login/logout itself.
  loginUser(USER_EMAIL, USER_PASSWORD);

  authTests();       // /me, invalid login, reset-request (session stays active)
  communityTests();   // communities, messages, reactions
  chatMessageTests(); // deep chat: pagination, replies, reactions, rate-limit, read
  threadTests();      // threads, likes, comments
  eventTests();       // events, rsvp, event comments
  profileTests();     // profile get/patch, interests, lottie-settings

  logout();

  // ── 5. Admin session ──────────────────────────────────────────────────────
  loginAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);

  adminReadTests();  // all admin GET endpoints
  adminWriteSmoke(); // create city + interest (smoke only — not in load/stress)

  logout();

  sleep(1);
}
