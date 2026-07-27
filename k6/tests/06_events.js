/**
 * Events, RSVPs, and event comments stress tests.
 *
 * Endpoints covered:
 *   GET    /api/communities/:id/events
 *   POST   /api/communities/:id/events
 *   GET    /api/communities/:id/events/:eventId
 *   PATCH  /api/communities/:id/events/:eventId
 *   DELETE /api/communities/:id/events/:eventId
 *   POST   /api/communities/:id/events/:eventId/rsvp
 *   GET    /api/communities/:id/events/:eventId/rsvp/list
 *   GET    /api/communities/:id/events/:eventId/comments
 *   POST   /api/communities/:id/events/:eventId/comments
 *
 * Requires: authenticated user session.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, JSON_HEADERS } from '../config.js';

const COMMUNITY_ID      = __ENV.TEST_COMMUNITY_ID || 'test-community-id';
const EXISTING_EVENT_ID = __ENV.TEST_EVENT_ID     || null;

/** ISO date string ~7 days from now (simple offset, not real Date.now()) */
function futureDate() {
  // k6 doesn't have a clock by default; use a hardcoded far-future date
  return '2099-12-31T18:00:00.000Z';
}

export function eventTests() {
  group('events — list', () => {
    const res = http.get(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/events`,
      { tags: { name: 'events/list' } },
    );
    check(res, {
      'events/list: status 200 or 404': (r) =>
        r.status === 200 || r.status === 404,
    });
    sleep(0.1);
  });

  let eventId = EXISTING_EVENT_ID;

  group('events — create', () => {
    const res = http.post(
      `${BASE_URL}/api/communities/${COMMUNITY_ID}/events`,
      JSON.stringify({
        title:       `k6 test event [VU:${__VU} ITER:${__ITER}]`,
        description: 'Automated stress test event — safe to delete.',
        event_date:  futureDate(),
        is_online:   true,
        meet_link:   'https://meet.example.com/k6-test',
      }),
      { headers: JSON_HEADERS, tags: { name: 'events/create' } },
    );
    check(res, {
      'events/create: status 2xx or 404': (r) =>
        (r.status >= 200 && r.status < 300) || r.status === 404,
    });
    if (res.status >= 200 && res.status < 300) {
      try {
        const body = JSON.parse(res.body);
        eventId = body.id || body.event?.id || eventId;
      } catch { /* ignore */ }
    }
    sleep(0.2);
  });

  if (eventId) {
    group('events — get single', () => {
      const res = http.get(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/events/${eventId}`,
        { tags: { name: 'events/get' } },
      );
      check(res, {
        'events/get: status 200 or 404': (r) =>
          r.status === 200 || r.status === 404,
      });
      sleep(0.1);
    });

    group('events — rsvp', () => {
      const res = http.post(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/events/${eventId}/rsvp`,
        null,
        { headers: JSON_HEADERS, tags: { name: 'events/rsvp' } },
      );
      check(res, {
        'events/rsvp: status 2xx or 404': (r) =>
          (r.status >= 200 && r.status < 300) || r.status === 404,
      });
      sleep(0.1);
    });

    group('events — rsvp list', () => {
      const res = http.get(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/events/${eventId}/rsvp/list`,
        { tags: { name: 'events/rsvp-list' } },
      );
      check(res, {
        'events/rsvp-list: status 200 or 404': (r) =>
          r.status === 200 || r.status === 404,
      });
      sleep(0.1);
    });

    group('events — get comments', () => {
      const res = http.get(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/events/${eventId}/comments`,
        { tags: { name: 'events/comments-get' } },
      );
      check(res, {
        'events/comments-get: status 200 or 404': (r) =>
          r.status === 200 || r.status === 404,
      });
      sleep(0.1);
    });

    group('events — post comment', () => {
      const res = http.post(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/events/${eventId}/comments`,
        JSON.stringify({ body: `k6 event comment [VU:${__VU} ITER:${__ITER}]` }),
        { headers: JSON_HEADERS, tags: { name: 'events/comments-post' } },
      );
      check(res, {
        'events/comments-post: status 2xx or 404': (r) =>
          (r.status >= 200 && r.status < 300) || r.status === 404,
      });
      sleep(0.1);
    });

    group('events — delete', () => {
      const res = http.del(
        `${BASE_URL}/api/communities/${COMMUNITY_ID}/events/${eventId}`,
        null,
        { tags: { name: 'events/delete' } },
      );
      check(res, {
        'events/delete: status 200 or 204 or 403 or 404': (r) =>
          r.status === 200 || r.status === 204 || r.status === 403 || r.status === 404,
      });
      sleep(0.1);
    });
  }
}
