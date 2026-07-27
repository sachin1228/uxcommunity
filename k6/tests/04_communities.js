/**
 * Communities, messages, and reactions stress tests.
 *
 * Endpoints covered:
 *   GET  /api/communities
 *   GET  /api/communities/all
 *   GET  /api/communities/:id
 *   GET  /api/communities/:id/stats
 *   GET  /api/communities/:id/messages
 *   POST /api/communities/:id/messages
 *   POST /api/communities/:id/messages/:msgId/reactions
 *   DELETE /api/communities/:id/messages/:msgId
 *   PATCH  /api/communities/:id/read
 *
 * Requires: authenticated user session (call loginUser before invoking these).
 * Set TEST_COMMUNITY_ID env var to a community the test user belongs to.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';
import { objectResponse, arrayResponse } from '../utils/checks.js';

const COMMUNITY_ID = __ENV.TEST_COMMUNITY_ID || 'test-community-id';

export function communityTests() {
  group('communities — list (member)', () => {
    const res = http.get(`${BASE_URL}/api/communities`, {
      tags: { name: 'communities/list' },
    });
    check(res, {
      'communities/list: status 200': (r) => r.status === 200,
      'communities/list: has communities array': (r) => {
        try { return Array.isArray(JSON.parse(r.body).communities); } catch { return false; }
      },
    });
    sleep(0.1);
  });

  group('communities — all', () => {
    const res = http.get(`${BASE_URL}/api/communities/all`, {
      tags: { name: 'communities/all' },
    });
    check(res, {
      'communities/all: status 200': (r) => r.status === 200,
    });
    sleep(0.1);
  });

  group('communities — single community', () => {
    const res = http.get(`${BASE_URL}/api/communities/${COMMUNITY_ID}`, {
      tags: { name: 'communities/single' },
    });
    check(res, {
      'communities/single: status 200 or 404': (r) =>
        r.status === 200 || r.status === 404,
    });
    sleep(0.1);
  });

  group('communities — stats', () => {
    const res = http.get(`${BASE_URL}/api/communities/${COMMUNITY_ID}/stats`, {
      tags: { name: 'communities/stats' },
    });
    check(res, {
      'communities/stats: status 200 or 404': (r) =>
        r.status === 200 || r.status === 404,
    });
    sleep(0.1);
  });

  group('communities — get messages', () => {
    const res = http.get(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/messages?limit=20`,
      { tags: { name: 'communities/messages-get' } },
    );
    check(res, {
      'communities/messages-get: status 200 or 404': (r) =>
        r.status === 200 || r.status === 404,
    });
    sleep(0.1);
  });

  // POST a message and capture the ID for follow-up checks
  let createdMsgId = null;

  group('communities — post message', () => {
    const res = http.post(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/messages`,
      JSON.stringify({ content: `k6 stress test message [VU:${__VU} ITER:${__ITER}]` }),
      { headers: JSON_HEADERS, tags: { name: 'communities/messages-post' } },
    );
    check(res, {
      'communities/messages-post: status 200 or 201 or 404': (r) =>
        r.status === 200 || r.status === 201 || r.status === 404,
    });
    if (res.status === 200 || res.status === 201) {
      try {
        const body = JSON.parse(res.body);
        createdMsgId = body.id || body.message?.id || null;
      } catch { /* ignore */ }
    }
    sleep(0.2);
  });

  if (createdMsgId) {
    group('communities — react to message', () => {
      const res = http.post(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/messages/${createdMsgId}/reactions`,
        JSON.stringify({ emoji: '👍' }),
        { headers: JSON_HEADERS, tags: { name: 'communities/reactions-post' } },
      );
      check(res, {
        'communities/reactions-post: status 2xx': (r) =>
          r.status >= 200 && r.status < 300,
      });
      sleep(0.1);
    });

    group('communities — delete own message', () => {
      const res = http.del(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/messages/${createdMsgId}`,
        null,
        { tags: { name: 'communities/messages-delete' } },
      );
      check(res, {
        'communities/messages-delete: status 200 or 204': (r) =>
          r.status === 200 || r.status === 204,
      });
      sleep(0.1);
    });
  }

  group('communities — mark as read', () => {
    const res = http.patch(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/read`,
      null,
      { tags: { name: 'communities/read-patch' } },
    );
    check(res, {
      'communities/read-patch: status 200 or 404': (r) =>
        r.status === 200 || r.status === 404,
    });
    sleep(0.1);
  });
}
