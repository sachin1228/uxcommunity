/**
 * Chat load test — simulates concurrent users actively chatting in a community.
 *
 * Each VU loops through a realistic chat session:
 *   1. Fetch latest messages (polling)
 *   2. Send a message
 *   3. React to a message
 *   4. Mark as read
 *   5. Check stats
 *
 * Scenarios:
 *   - default  : 20 VUs for 3 min — steady active-chat load
 *   - spike    : ramps to 100 VUs to model a sudden burst (e.g. live event)
 *
 * Usage:
 *   # Steady chat load
 *   k6 run k6/scenarios/chat_load.js \
 *     -e BASE_URL=https://drafthub-web.vercel.app \
 *     -e TEST_USER_EMAIL=member@example.com \
 *     -e TEST_USER_PASSWORD=secret \
 *     -e TEST_COMMUNITY_ID=<uuid>
 *
 *   # Run only the spike scenario
 *   k6 run k6/scenarios/chat_load.js --scenario spike \
 *     -e BASE_URL=https://drafthub-web.vercel.app \
 *     ...
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { THRESHOLDS, BASE_URL, JSON_HEADERS } from '../config.js';
import { loginUser, logout } from '../utils/auth.js';

export const options = {
  scenarios: {
    // Sustained active-chat session
    steady_chat: {
      executor: 'constant-vus',
      vus: 20,
      duration: '3m',
      tags: { scenario: 'steady_chat' },
    },
    // Sudden burst — event goes live, everyone opens chat
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m',  target: 100 },
        { duration: '30s', target: 0 },
      ],
      startTime: '3m30s', // starts after steady_chat finishes
      tags: { scenario: 'spike' },
    },
  },
  thresholds: {
    ...THRESHOLDS,
    // Chat-specific: message send p(95) under 3s (higher tolerance — DB write)
    'http_req_duration{name:chat/messages-post}': ['p(95)<3000'],
    // Reaction toggle should be snappy
    'http_req_duration{name:chat/reactions-add}': ['p(95)<2000'],
    // Read receipt is fire-and-forget — allow higher latency
    'http_req_duration{name:chat/read-patch}': ['p(95)<3000'],
  },
};

const COMMUNITY_ID = __ENV.TEST_COMMUNITY_ID || 'test-community-id';
const USER_EMAIL    = __ENV.TEST_USER_EMAIL    || 'testuser@example.com';
const USER_PASSWORD = __ENV.TEST_USER_PASSWORD || 'password123';
const BASE_MSG_URL  = `${BASE_URL}/api/communities/${COMMUNITY_ID}/messages`;

const EMOJIS = ['👍', '❤️', '🔥', '😂', '👀', '🎉', '💯', '🙌'];

export function setup() {
  // Nothing to set up — each VU manages its own session
}

export default function () {
  // Each VU logs in independently (simulates a different browser session)
  loginUser(USER_EMAIL, USER_PASSWORD);

  // ── Poll for latest messages ──────────────────────────────────────────────
  let latestMsgId = null;

  group('chat — poll messages', () => {
    const res = http.get(BASE_MSG_URL, {
      tags: { name: 'chat/messages-get' },
    });
    check(res, {
      'chat/poll: status 200': (r) => r.status === 200,
      'chat/poll: messages array': (r) => {
        try { return Array.isArray(JSON.parse(r.body).messages); } catch { return false; }
      },
    });
    if (res.status === 200) {
      try {
        const msgs = JSON.parse(res.body).messages;
        if (msgs && msgs.length > 0) latestMsgId = msgs[0].id;
      } catch { /* ignore */ }
    }
    sleep(0.5);
  });

  // ── Send a message ────────────────────────────────────────────────────────
  let sentMsgId = null;

  group('chat — send message', () => {
    const res = http.post(
      BASE_MSG_URL,
      JSON.stringify({
        content: `[VU:${__VU}] Hey there! Stress test message — iteration ${__ITER}.`,
      }),
      { headers: JSON_HEADERS, tags: { name: 'chat/messages-post' } },
    );
    check(res, {
      'chat/send: 201 or 429': (r) => r.status === 201 || r.status === 429,
      'chat/send: message id (when 201)': (r) => {
        if (r.status !== 201) return true;
        try { return !!JSON.parse(r.body).message.id; } catch { return false; }
      },
    });
    if (res.status === 201) {
      try { sentMsgId = JSON.parse(res.body).message.id; } catch { /* ignore */ }
    }
    // Respect the 5/10s rate limit — each VU thinks for ~2s between messages
    sleep(2);
  });

  // ── React to a message ────────────────────────────────────────────────────
  const reactTarget = sentMsgId || latestMsgId;
  if (reactTarget) {
    group('chat — react to message', () => {
      const emoji = EMOJIS[__VU % EMOJIS.length];
      const res = http.post(
        `${BASE_MSG_URL}/${reactTarget}/reactions`,
        JSON.stringify({ emoji }),
        { headers: JSON_HEADERS, tags: { name: 'chat/reactions-add' } },
      );
      check(res, {
        'chat/react: status 200': (r) => r.status === 200,
        'chat/react: reactions array': (r) => {
          try { return Array.isArray(JSON.parse(r.body).reactions); } catch { return false; }
        },
      });
      sleep(0.2);
    });
  }

  // ── Mark community as read ────────────────────────────────────────────────
  group('chat — mark read', () => {
    const res = http.patch(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/read`,
      null,
      { tags: { name: 'chat/read-patch' } },
    );
    check(res, {
      'chat/read: status 200': (r) => r.status === 200,
      'chat/read: ok true': (r) => {
        try { return JSON.parse(r.body).ok === true; } catch { return false; }
      },
    });
    sleep(0.1);
  });

  // ── Check stats ───────────────────────────────────────────────────────────
  group('chat — stats', () => {
    const res = http.get(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/stats`,
      { tags: { name: 'chat/stats-get' } },
    );
    check(res, {
      'chat/stats: status 200': (r) => r.status === 200,
      'chat/stats: posts_today is number': (r) => {
        try { return typeof JSON.parse(r.body).posts_today === 'number'; } catch { return false; }
      },
    });
    sleep(0.1);
  });

  // ── Clean up own message ──────────────────────────────────────────────────
  if (sentMsgId) {
    group('chat — delete own message', () => {
      const res = http.del(
        `${BASE_MSG_URL}/${sentMsgId}`,
        null,
        { tags: { name: 'chat/messages-delete' } },
      );
      check(res, {
        'chat/delete: status 200': (r) => r.status === 200,
      });
      sleep(0.1);
    });
  }

  logout();

  // Think time between chat sessions — simulates user reading before replying
  sleep(1);
}
