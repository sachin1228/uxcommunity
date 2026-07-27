/**
 * Concurrent chat load test — thousands of distinct users all chatting
 * in the same community at the same time.
 *
 * Each VU picks a pre-seeded user from k6/data/test-users.json and sets
 * their JWT directly as the draft_session cookie — NO login API calls,
 * so the login rate limiter is completely bypassed.
 *
 * Prerequisites:
 *   node k6/scripts/seed-users.js   ← creates users + generates tokens
 *
 * Usage:
 *   k6 run k6/scenarios/chat_concurrent.js \
 *     -e BASE_URL=https://drafthub-web.vercel.app \
 *     -e TEST_COMMUNITY_ID=<uuid>
 *
 *   # Override concurrent VUs (must be ≤ users in test-users.json)
 *   k6 run k6/scenarios/chat_concurrent.js \
 *     -e BASE_URL=https://drafthub-web.vercel.app \
 *     -e TEST_COMMUNITY_ID=<uuid> \
 *     -e CONCURRENT_VUS=500
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, JSON_HEADERS } from '../config.js';
import { loadSeededUsers } from '../utils/test-users.js';

// ── Load pre-seeded users (includes pre-signed session tokens) ────────────
const users = new SharedArray('test-users', function () {
  return loadSeededUsers('../data/test-users.json');
});

// ── Config ────────────────────────────────────────────────────────────────
const COMMUNITY_ID = __ENV.TEST_COMMUNITY_ID || 'test-community-id';
const MAX_VUS      = parseInt(__ENV.CONCURRENT_VUS || String(Math.min(users.length, 500)), 10);
const BASE_MSG_URL = `${BASE_URL}/api/communities/${COMMUNITY_ID}/messages`;
const COOKIE_URL   = BASE_URL; // cookie jar scope

// ── Custom metrics ────────────────────────────────────────────────────────
const messagesSent     = new Counter('chat_messages_sent');
const messagesRejected = new Counter('chat_messages_rejected');
const reactionsSent    = new Counter('chat_reactions_sent');
const rateLimitHits    = new Counter('chat_rate_limit_hits');
const messageSendTime  = new Trend('chat_message_send_ms', true);
const pollTime         = new Trend('chat_poll_ms', true);

// ── Scenarios ─────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    concurrent_chat: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m',  target: 10      },  // warm-up
        { duration: '3m',  target: MAX_VUS },  // ramp to peak
        { duration: '5m',  target: MAX_VUS },  // hold at peak
        { duration: '1m',  target: 0       },  // cool-down
      ],
    },
  },
  thresholds: {
    chat_message_send_ms:              ['p(95)<3000'],
    chat_poll_ms:                      ['p(95)<2000'],
    'http_req_duration{name:chat/send}': ['p(95)<3000'],
    'http_req_duration{name:chat/poll}': ['p(95)<2000'],
    http_req_failed:                   ['rate<0.20'],
    checks:                            ['rate>0.90'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Inject the pre-signed JWT as the draft_session cookie so the app treats
 * this VU as already logged in — no /api/auth/login call needed.
 */
function injectSession(token) {
  const jar = http.cookieJar();
  jar.set(COOKIE_URL, 'draft_session', token, { path: '/' });
}

const EMOJIS = ['👍', '❤️', '🔥', '😂', '👀', '🎉', '💯', '🙌', '😍', '🤩'];

// ── Main VU loop ──────────────────────────────────────────────────────────
export default function () {
  // Pick a unique user for this VU (wraps if VUs > user count)
  const user = users[(__VU - 1) % users.length];

  // Set the session cookie — replaces login entirely
  injectSession(user.sessionToken);

  // ── 1. Poll latest messages ──────────────────────────────────────────
  let latestMsgId   = null;
  let oldestMsgTime = null;

  group('poll messages', () => {
    const start = Date.now();
    const res   = http.get(BASE_MSG_URL, { tags: { name: 'chat/poll' } });
    pollTime.add(Date.now() - start);

    check(res, {
      'poll: status 200': (r) => r.status === 200,
      'poll: messages array': (r) => {
        try { return Array.isArray(JSON.parse(r.body).messages); } catch { return false; }
      },
    });

    if (res.status === 200) {
      try {
        const msgs = JSON.parse(res.body).messages;
        if (msgs && msgs.length > 0) {
          latestMsgId   = msgs[0].id;
          oldestMsgTime = msgs[msgs.length - 1].created_at;
        }
      } catch { /* ignore */ }
    }
    sleep(0.3);
  });

  // ── 2. Send a message ────────────────────────────────────────────────
  let sentMsgId = null;

  group('send message', () => {
    const start = Date.now();
    const res   = http.post(
      BASE_MSG_URL,
      JSON.stringify({
        content: `[${user.name}] k6 concurrent chat test — VU ${__VU} iter ${__ITER}`,
      }),
      { headers: JSON_HEADERS, tags: { name: 'chat/send' } },
    );
    messageSendTime.add(Date.now() - start);

    check(res, {
      'send: 201 or 429': (r) => r.status === 201 || r.status === 429,
      'send: message id (when 201)': (r) => {
        if (r.status !== 201) return true;
        try { return !!JSON.parse(r.body).message.id; } catch { return false; }
      },
    });

    if (res.status === 201) {
      messagesSent.add(1);
      try { sentMsgId = JSON.parse(res.body).message.id; } catch { /* ignore */ }
    } else if (res.status === 429) {
      rateLimitHits.add(1);
      messagesRejected.add(1);
    }

    // 2s think-time — respects the 5 messages/10s per-user rate limit
    sleep(2 + Math.random());
  });

  // ── 3. Send a reply (40% of users) ──────────────────────────────────
  const replyTarget = latestMsgId || sentMsgId;

  if (replyTarget && Math.random() < 0.4) {
    group('send reply', () => {
      const res = http.post(
        BASE_MSG_URL,
        JSON.stringify({
          content:     `[${user.name}] replying — VU ${__VU}`,
          reply_to_id: replyTarget,
        }),
        { headers: JSON_HEADERS, tags: { name: 'chat/reply' } },
      );
      check(res, {
        'reply: 201 or 429': (r) => r.status === 201 || r.status === 429,
      });
      if (res.status === 201) messagesSent.add(1);
      if (res.status === 429) rateLimitHits.add(1);
      sleep(1);
    });
  }

  // ── 4. React to a message ────────────────────────────────────────────
  const reactTarget = sentMsgId || latestMsgId;

  if (reactTarget) {
    group('react', () => {
      const emoji = EMOJIS[__VU % EMOJIS.length];
      const res   = http.post(
        `${BASE_MSG_URL}/${reactTarget}/reactions`,
        JSON.stringify({ emoji }),
        { headers: JSON_HEADERS, tags: { name: 'chat/react' } },
      );
      check(res, {
        'react: status 200': (r) => r.status === 200,
        'react: reactions array': (r) => {
          try { return Array.isArray(JSON.parse(r.body).reactions); } catch { return false; }
        },
      });
      if (res.status === 200) reactionsSent.add(1);
      sleep(0.2);
    });
  }

  // ── 5. Poll new messages (after cursor — simulates real-time feel) ───
  if (oldestMsgTime) {
    group('poll new (after cursor)', () => {
      const res = http.get(
        `${BASE_MSG_URL}?after=${encodeURIComponent(oldestMsgTime)}`,
        { tags: { name: 'chat/poll-after' } },
      );
      check(res, {
        'poll-after: status 200': (r) => r.status === 200,
      });
      sleep(0.2);
    });
  }

  // ── 6. Mark community as read ────────────────────────────────────────
  group('mark read', () => {
    const res = http.patch(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/read`,
      null,
      { tags: { name: 'chat/read' } },
    );
    check(res, {
      'read: status 200': (r) => r.status === 200,
      'read: ok true': (r) => {
        try { return JSON.parse(r.body).ok === true; } catch { return false; }
      },
    });
    sleep(0.1);
  });

  // ── 7. Get community stats ───────────────────────────────────────────
  group('stats', () => {
    const res = http.get(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/stats`,
      { tags: { name: 'chat/stats' } },
    );
    check(res, {
      'stats: status 200': (r) => r.status === 200,
      'stats: posts_today is number': (r) => {
        try { return typeof JSON.parse(r.body).posts_today === 'number'; } catch { return false; }
      },
    });
    sleep(0.1);
  });

  // ── 8. Clean up own message ──────────────────────────────────────────
  if (sentMsgId) {
    group('delete own message', () => {
      const res = http.del(
        `${BASE_MSG_URL}/${sentMsgId}`,
        null,
        { tags: { name: 'chat/delete' } },
      );
      check(res, {
        'delete: status 200': (r) => r.status === 200,
      });
      sleep(0.1);
    });
  }

  // Think-time between iterations (user reads before typing again)
  sleep(1 + Math.random() * 2);
}
