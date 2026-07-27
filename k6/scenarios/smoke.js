/**
 * Smoke test — 1 VU, 1 iteration.
 *
 * Runs every endpoint group once to confirm the app is alive and all routes
 * respond with expected status codes. Run this before every load/stress test.
 *
 * Usage:
 *   k6 run k6/scenarios/smoke.js \
 *     -e BASE_URL=https://drafthub-web.vercel.app \
 *     -e ADMIN_EMAIL=admin@drafthub.com \
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

// Use a real seeded k6 test user. Override via -e TEST_USER_EMAIL / TEST_USER_PASSWORD.
// The seeder creates users with pattern k6userNNN@k6test.invalid / K6testPass123!
const USER_EMAIL     = __ENV.TEST_USER_EMAIL    || 'k6user001@k6test.invalid';
const USER_PASSWORD  = __ENV.TEST_USER_PASSWORD || 'K6testPass123!';
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
  chatMessageTests(); // deep chat: pagination, replies, reactions, rate-limit, read, stats
  threadTests();      // threads, votes, comments
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
