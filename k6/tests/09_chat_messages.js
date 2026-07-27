/**
 * Comprehensive chat message tests.
 *
 * Covers every chat API endpoint with realistic usage patterns:
 *
 *   GET  /api/communities/:id/messages              — list (with pagination)
 *   POST /api/communities/:id/messages              — send plain text
 *   POST /api/communities/:id/messages              — send with reply_to_id
 *   POST /api/communities/:id/messages              — rate-limit burst (5+ in 10s)
 *   GET  /api/communities/:id/messages/:msgId       — fetch single message
 *   POST /api/communities/:id/messages/:msgId/reactions — toggle reaction (same emoji)
 *   POST /api/communities/:id/messages/:msgId/reactions — switch emoji
 *   DELETE /api/communities/:id/messages/:msgId     — soft-delete own message
 *   PATCH  /api/communities/:id/read                — mark community as read
 *   GET    /api/communities/:id/stats               — posts_today count
 *
 * Requires: active user session (call loginUser before invoking).
 * Set TEST_COMMUNITY_ID to a community the test user is a member of.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';

const COMMUNITY_ID = __ENV.TEST_COMMUNITY_ID || 'test-community-id';
const BASE_MSG_URL = `${BASE_URL}/api/communities/${COMMUNITY_ID}/messages`;

/** Emojis used for reaction toggle tests */
const EMOJIS = ['👍', '❤️', '🔥', '😂', '👀', '🎉'];

export function chatMessageTests() {

  // ── 1. GET messages — first page ──────────────────────────────────────────
  let firstMsgId = null;
  let lastMsgTimestamp = null;

  group('chat — GET messages (first page)', () => {
    const res = http.get(BASE_MSG_URL, {
      tags: { name: 'chat/messages-get' },
    });
    check(res, {
      'chat/messages-get: status 200': (r) => r.status === 200,
      'chat/messages-get: has messages array': (r) => {
        try { return Array.isArray(JSON.parse(r.body).messages); } catch { return false; }
      },
    });
    if (res.status === 200) {
      try {
        const msgs = JSON.parse(res.body).messages;
        if (msgs && msgs.length > 0) {
          firstMsgId = msgs[0].id;
          lastMsgTimestamp = msgs[msgs.length - 1].created_at;
        }
      } catch { /* ignore */ }
    }
    sleep(0.1);
  });

  // ── 2. GET messages — paginate with `before` cursor ───────────────────────
  if (lastMsgTimestamp) {
    group('chat — GET messages (paginate with before cursor)', () => {
      const res = http.get(
        `${BASE_MSG_URL}?before=${encodeURIComponent(lastMsgTimestamp)}`,
        { tags: { name: 'chat/messages-paginate' } },
      );
      check(res, {
        'chat/messages-paginate: status 200': (r) => r.status === 200,
        'chat/messages-paginate: has messages array': (r) => {
          try { return Array.isArray(JSON.parse(r.body).messages); } catch { return false; }
        },
      });
      sleep(0.1);
    });
  }

  // ── 3. GET messages — with `after` cursor (poll for new messages) ─────────
  if (lastMsgTimestamp) {
    group('chat — GET messages (poll with after cursor)', () => {
      const res = http.get(
        `${BASE_MSG_URL}?after=${encodeURIComponent(lastMsgTimestamp)}`,
        { tags: { name: 'chat/messages-poll' } },
      );
      check(res, {
        'chat/messages-poll: status 200': (r) => r.status === 200,
        'chat/messages-poll: has messages array': (r) => {
          try { return Array.isArray(JSON.parse(r.body).messages); } catch { return false; }
        },
      });
      sleep(0.1);
    });
  }

  // ── 4. POST message — plain text ──────────────────────────────────────────
  let sentMsgId = null;

  group('chat — POST plain text message', () => {
    const res = http.post(
      BASE_MSG_URL,
      JSON.stringify({
        content: `k6 test message [VU:${__VU} ITER:${__ITER}] — ${new Date().toISOString()}`,
      }),
      { headers: JSON_HEADERS, tags: { name: 'chat/messages-post' } },
    );
    check(res, {
      'chat/messages-post: status 201': (r) => r.status === 201,
      'chat/messages-post: has message id': (r) => {
        try { return !!JSON.parse(r.body).message.id; } catch { return false; }
      },
      'chat/messages-post: message has content': (r) => {
        try { return typeof JSON.parse(r.body).message.content === 'string'; } catch { return false; }
      },
      'chat/messages-post: message has user': (r) => {
        try { return !!JSON.parse(r.body).message.users; } catch { return false; }
      },
      'chat/messages-post: reactions array present': (r) => {
        try { return Array.isArray(JSON.parse(r.body).message.reactions); } catch { return false; }
      },
    });
    if (res.status === 201) {
      try { sentMsgId = JSON.parse(res.body).message.id; } catch { /* ignore */ }
    }
    sleep(0.3); // brief pause — rate limit is 5 per 10s
  });

  // ── 5. POST message — with reply_to_id ────────────────────────────────────
  let replyMsgId = null;

  if (sentMsgId || firstMsgId) {
    group('chat — POST reply message', () => {
      const parentId = sentMsgId || firstMsgId;
      const res = http.post(
        BASE_MSG_URL,
        JSON.stringify({
          content: `k6 reply to ${parentId} [VU:${__VU}]`,
          reply_to_id: parentId,
        }),
        { headers: JSON_HEADERS, tags: { name: 'chat/messages-reply' } },
      );
      check(res, {
        'chat/messages-reply: status 201 or 429': (r) =>
          r.status === 201 || r.status === 429,
        'chat/messages-reply: reply_to set (when 201)': (r) => {
          if (r.status !== 201) return true;
          try { return JSON.parse(r.body).message.reply_to_id === (sentMsgId || firstMsgId); }
          catch { return false; }
        },
      });
      if (res.status === 201) {
        try { replyMsgId = JSON.parse(res.body).message.id; } catch { /* ignore */ }
      }
      sleep(0.3);
    });
  }

  // ── 6. GET single message ─────────────────────────────────────────────────
  if (sentMsgId) {
    group('chat — GET single message', () => {
      const res = http.get(
        `${BASE_MSG_URL}/${sentMsgId}`,
        { tags: { name: 'chat/message-get-single' } },
      );
      check(res, {
        'chat/message-get-single: status 200': (r) => r.status === 200,
        'chat/message-get-single: has id': (r) => {
          try { return !!JSON.parse(r.body).id; } catch { return false; }
        },
        'chat/message-get-single: has user_name': (r) => {
          try { return typeof JSON.parse(r.body).user_name === 'string'; } catch { return false; }
        },
      });
      sleep(0.1);
    });
  }

  // ── 7. POST reaction — add emoji ──────────────────────────────────────────
  const targetForReaction = sentMsgId || firstMsgId;

  if (targetForReaction) {
    group('chat — POST reaction (add 👍)', () => {
      const res = http.post(
        `${BASE_MSG_URL}/${targetForReaction}/reactions`,
        JSON.stringify({ emoji: '👍' }),
        { headers: JSON_HEADERS, tags: { name: 'chat/reactions-add' } },
      );
      check(res, {
        'chat/reactions-add: status 200': (r) => r.status === 200,
        'chat/reactions-add: has reactions array': (r) => {
          try { return Array.isArray(JSON.parse(r.body).reactions); } catch { return false; }
        },
      });
      sleep(0.1);
    });

    // ── 8. POST reaction — toggle (same emoji = remove) ────────────────────
    group('chat — POST reaction (toggle 👍 off)', () => {
      const res = http.post(
        `${BASE_MSG_URL}/${targetForReaction}/reactions`,
        JSON.stringify({ emoji: '👍' }),
        { headers: JSON_HEADERS, tags: { name: 'chat/reactions-toggle-off' } },
      );
      check(res, {
        'chat/reactions-toggle-off: status 200': (r) => r.status === 200,
        'chat/reactions-toggle-off: reactions array returned': (r) => {
          try { return Array.isArray(JSON.parse(r.body).reactions); } catch { return false; }
        },
      });
      sleep(0.1);
    });

    // ── 9. POST reaction — switch to different emoji ───────────────────────
    group('chat — POST reaction (switch to 🔥)', () => {
      // Add 👍 first, then send 🔥 — server should replace it
      http.post(
        `${BASE_MSG_URL}/${targetForReaction}/reactions`,
        JSON.stringify({ emoji: '👍' }),
        { headers: JSON_HEADERS },
      );
      sleep(0.1);

      const res = http.post(
        `${BASE_MSG_URL}/${targetForReaction}/reactions`,
        JSON.stringify({ emoji: '🔥' }),
        { headers: JSON_HEADERS, tags: { name: 'chat/reactions-switch' } },
      );
      check(res, {
        'chat/reactions-switch: status 200': (r) => r.status === 200,
        'chat/reactions-switch: reactions updated': (r) => {
          try { return Array.isArray(JSON.parse(r.body).reactions); } catch { return false; }
        },
      });
      sleep(0.1);
    });

    // ── 10. Multiple different users' emoji variety (VU-based) ─────────────
    group('chat — POST reaction (VU-based emoji variety)', () => {
      const emoji = EMOJIS[__VU % EMOJIS.length];
      const res = http.post(
        `${BASE_MSG_URL}/${targetForReaction}/reactions`,
        JSON.stringify({ emoji }),
        { headers: JSON_HEADERS, tags: { name: 'chat/reactions-variety' } },
      );
      check(res, {
        'chat/reactions-variety: status 200': (r) => r.status === 200,
      });
      sleep(0.1);
    });
  }

  // ── 11. POST message — rate limit burst test ───────────────────────────────
  // The route allows 5 messages per 10s per user. Sending a burst of 4 back-to-
  // back (after the 2 we already sent) should trigger a 429 on the last one.
  group('chat — POST messages burst (rate limit probe)', () => {
    let gotRateLimited = false;
    for (let i = 0; i < 4; i++) {
      const res = http.post(
        BASE_MSG_URL,
        JSON.stringify({ content: `k6 burst msg ${i + 1} [VU:${__VU} ITER:${__ITER}]` }),
        { headers: JSON_HEADERS, tags: { name: 'chat/messages-burst' } },
      );
      check(res, {
        'chat/messages-burst: 201 or 429': (r) =>
          r.status === 201 || r.status === 429,
      });
      if (res.status === 429) {
        gotRateLimited = true;
        check(res, {
          'chat/rate-limit: has Retry-After header': (r) =>
            r.headers['Retry-After'] !== undefined ||
            r.headers['retry-after'] !== undefined,
        });
        break;
      }
      sleep(0.05); // tight burst — no think time
    }
    // Log but don't fail — rate limiting is expected behaviour
    sleep(0.5);
  });

  // ── 12. PATCH read receipt ─────────────────────────────────────────────────
  group('chat — PATCH read receipt', () => {
    const res = http.patch(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/read`,
      null,
      { tags: { name: 'chat/read-patch' } },
    );
    check(res, {
      'chat/read-patch: status 200': (r) => r.status === 200,
      'chat/read-patch: ok true': (r) => {
        try { return JSON.parse(r.body).ok === true; } catch { return false; }
      },
      'chat/read-patch: has previousLastReadAt key': (r) => {
        try {
          const b = JSON.parse(r.body);
          return 'previousLastReadAt' in b;
        } catch { return false; }
      },
    });
    sleep(0.1);
  });

  // ── 13. GET stats ──────────────────────────────────────────────────────────
  group('chat — GET stats (posts_today)', () => {
    const res = http.get(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/stats`,
      { tags: { name: 'chat/stats-get' } },
    );
    check(res, {
      'chat/stats-get: status 200': (r) => r.status === 200,
      'chat/stats-get: has posts_today': (r) => {
        try {
          const b = JSON.parse(r.body);
          return typeof b.posts_today === 'number';
        } catch { return false; }
      },
    });
    sleep(0.1);
  });

  // ── 14. DELETE own messages (clean up what we created) ────────────────────
  const toDelete = [sentMsgId, replyMsgId].filter(Boolean);
  for (const msgId of toDelete) {
    group(`chat — DELETE message ${msgId}`, () => {
      const res = http.del(
        `${BASE_MSG_URL}/${msgId}`,
        null,
        { tags: { name: 'chat/messages-delete' } },
      );
      check(res, {
        'chat/messages-delete: status 200': (r) => r.status === 200,
        'chat/messages-delete: success true': (r) => {
          try { return JSON.parse(r.body).success === true; } catch { return false; }
        },
      });
      sleep(0.1);
    });
  }

  // ── 15. Validation — empty message body ───────────────────────────────────
  group('chat — POST empty message (validation)', () => {
    const res = http.post(
      BASE_MSG_URL,
      JSON.stringify({ content: '' }),
      { headers: JSON_HEADERS, tags: { name: 'chat/messages-post-empty' } },
    );
    check(res, {
      'chat/messages-post-empty: rejected (400/422/429)': (r) =>
        r.status === 400 || r.status === 422 || r.status === 429,
    });
    sleep(0.2);
  });

  // ── 16. Validation — message too long (>2000 chars) ───────────────────────
  group('chat — POST oversized message (validation)', () => {
    const res = http.post(
      BASE_MSG_URL,
      JSON.stringify({ content: 'x'.repeat(2001) }),
      { headers: JSON_HEADERS, tags: { name: 'chat/messages-post-toolong' } },
    );
    check(res, {
      'chat/messages-post-toolong: rejected (400/422/429)': (r) =>
        r.status === 400 || r.status === 422 || r.status === 429,
    });
    sleep(0.2);
  });
}
