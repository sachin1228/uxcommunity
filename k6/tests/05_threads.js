/**
 * Threads, comments, and votes stress tests.
 *
 * Endpoints covered:
 *   GET    /api/communities/:id/threads
 *   POST   /api/communities/:id/threads
 *   GET    /api/communities/:id/threads/:threadId
 *   PATCH  /api/communities/:id/threads/:threadId
 *   DELETE /api/communities/:id/threads/:threadId
 *   POST   /api/communities/:id/threads/:threadId/vote
 *   GET    /api/communities/:id/threads/:threadId/comments
 *   POST   /api/communities/:id/threads/:threadId/comments
 *   DELETE /api/communities/:id/threads/:threadId/comments/:commentId
 *
 * Requires: authenticated user session.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';

const COMMUNITY_ID = __ENV.TEST_COMMUNITY_ID || 'test-community-id';
const EXISTING_THREAD_ID = __ENV.TEST_THREAD_ID || null;

export function threadTests() {
  group('threads — list', () => {
    const res = http.get(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads`,
      { tags: { name: 'threads/list' } },
    );
    check(res, {
      'threads/list: status 200 or 404': (r) =>
        r.status === 200 || r.status === 404,
    });
    sleep(0.1);
  });

  // Create a thread and use its ID for follow-up operations
  let threadId = EXISTING_THREAD_ID;

  group('threads — create', () => {
    const res = http.post(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads`,
      JSON.stringify({
        title:       `k6 test thread [VU:${__VU} ITER:${__ITER}]`,
        description: 'Automated stress test thread — safe to delete.',
        category:    'discussion', // valid: question|discussion|idea|feedback|referral|collaboration
        tags:        ['k6', 'test'],
        links:       [],
        attachments: [],
      }),
      { headers: JSON_HEADERS, tags: { name: 'threads/create' } },
    );
    check(res, {
      'threads/create: status 2xx or 404': (r) =>
        (r.status >= 200 && r.status < 300) || r.status === 404,
    });
    if (res.status >= 200 && res.status < 300) {
      try {
        const body = JSON.parse(res.body);
        threadId = body.id || body.thread?.id || threadId;
      } catch { /* ignore */ }
    }
    sleep(0.2);
  });

  if (threadId) {
    group('threads — get single', () => {
      const res = http.get(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads/${threadId}`,
        { tags: { name: 'threads/get' } },
      );
      check(res, {
        'threads/get: status 200 or 404': (r) =>
          r.status === 200 || r.status === 404,
      });
      sleep(0.1);
    });

    group('threads — vote', () => {
      const res = http.post(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads/${threadId}/vote`,
        null,
        { headers: JSON_HEADERS, tags: { name: 'threads/vote' } },
      );
      check(res, {
        'threads/vote: status 2xx or 404': (r) =>
          (r.status >= 200 && r.status < 300) || r.status === 404,
      });
      sleep(0.1);
    });

    group('threads — list comments', () => {
      const res = http.get(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads/${threadId}/comments`,
        { tags: { name: 'threads/comments-list' } },
      );
      check(res, {
        'threads/comments-list: status 200 or 404': (r) =>
          r.status === 200 || r.status === 404,
      });
      sleep(0.1);
    });

    let commentId = null;

    group('threads — post comment', () => {
      const res = http.post(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads/${threadId}/comments`,
        JSON.stringify({ body: `k6 comment [VU:${__VU} ITER:${__ITER}]` }),
        { headers: JSON_HEADERS, tags: { name: 'threads/comments-post' } },
      );
      check(res, {
        'threads/comments-post: status 2xx or 404': (r) =>
          (r.status >= 200 && r.status < 300) || r.status === 404,
      });
      if (res.status >= 200 && res.status < 300) {
        try {
          const body = JSON.parse(res.body);
          commentId = body.id || body.comment?.id || null;
        } catch { /* ignore */ }
      }
      sleep(0.1);
    });

    if (commentId) {
      group('threads — delete comment', () => {
        const res = http.del(
          `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads/${threadId}/comments/${commentId}`,
          null,
          { tags: { name: 'threads/comments-delete' } },
        );
        check(res, {
          'threads/comments-delete: status 200 or 204 or 404': (r) =>
            r.status === 200 || r.status === 204 || r.status === 404,
        });
        sleep(0.1);
      });
    }

    group('threads — patch (update title + description)', () => {
      const res = http.patch(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads/${threadId}`,
        JSON.stringify({
          title:       `k6 updated thread [VU:${__VU}]`,
          description: 'Updated by k6 stress test — safe to delete.',
          category:    'discussion',
          tags:        [],
          links:       [],
          attachments: [],
        }),
        { headers: JSON_HEADERS, tags: { name: 'threads/patch' } },
      );
      check(res, {
        'threads/patch: status 2xx or 403 or 404': (r) =>
          (r.status >= 200 && r.status < 300) || r.status === 403 || r.status === 404,
      });
      sleep(0.1);
    });

    group('threads — delete', () => {
      const res = http.del(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/threads/${threadId}`,
        null,
        { tags: { name: 'threads/delete' } },
      );
      check(res, {
        'threads/delete: status 200 or 204 or 403 or 404': (r) =>
          r.status === 200 || r.status === 204 || r.status === 403 || r.status === 404,
      });
      sleep(0.1);
    });
  }
}
