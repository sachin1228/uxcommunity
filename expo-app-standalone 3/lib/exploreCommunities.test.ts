/**
 * Which rows each Explore tab shows, and how the discovery list splits into
 * its two sections.
 *
 * The guarantees, ported with the web page's own coverage: Explore browses
 * public communities only (private rows are never listed, even when the member
 * already asked to join), profile-mirror communities stay unbrowsable, and the
 * requests tab is the member's own outgoing requests rather than discovery.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EXPLORE_TABS,
  splitExploreRows,
  visibleExploreRows,
  type ExploreCommunity,
} from './exploreCommunities';

function row(overrides: Partial<ExploreCommunity> & { id: string }): ExploreCommunity {
  return {
    name: overrides.id,
    type: 'user',
    image_url: null,
    description: null,
    member_count: 5,
    joined: false,
    can_join: true,
    ...overrides,
  };
}

const ids = (rows: ExploreCommunity[]) => rows.map((c) => c.id);

test('Explore offers two pills: All and Requests sent', () => {
  assert.deepEqual(
    EXPLORE_TABS.map((t) => t.value),
    ['all', 'requests'],
  );
});

test('joined and profile-mirror communities never appear as discoverable', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'joined', joined: true }),
    row({ id: 'city', type: 'city' }),
    row({ id: 'sector', type: 'sector' }),
    row({ id: 'experience', type: 'experience_level' }),
    row({ id: 'title', type: 'job_title' }),
    row({ id: 'b' }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, 'all', '')), ['a', 'b']);
});

test('private rows are never browsable, even with a pending request', () => {
  const rows = [
    row({ id: 'asked', is_private: true, can_join: false, has_pending_request: true }),
    row({ id: 'unasked', is_private: true, can_join: false }),
    row({ id: 'open' }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, 'all', '')), ['open']);
});

test('a row written before is_private existed reads as public', () => {
  const rows = [row({ id: 'unflagged' }), row({ id: 'invite-only', is_private: true })];

  assert.deepEqual(ids(visibleExploreRows(rows, 'all', '')), ['unflagged']);
});

test('the requests tab is the member’s own pending requests', () => {
  const rows = [
    row({ id: 'asked', is_private: true, can_join: false, has_pending_request: true }),
    row({ id: 'mirror', type: 'sector', is_private: true, has_pending_request: true }),
    row({ id: 'unasked', is_private: true, can_join: false }),
    row({ id: 'open' }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, 'requests', '')), ['asked', 'mirror']);
});

test('search matches a name substring, case-insensitively', () => {
  const rows = [
    row({ id: '1', name: 'Mobile Design System' }),
    row({ id: '2', name: 'Hiring' }),
    row({ id: '3', name: 'Mobile Guild', is_private: true, has_pending_request: true }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, 'all', 'mobile')), ['1']);
  assert.deepEqual(ids(visibleExploreRows(rows, 'all', '  MOBILE  ')), ['1']);
  assert.deepEqual(ids(visibleExploreRows(rows, 'all', '')), ['1', '2']);
  assert.deepEqual(ids(visibleExploreRows(rows, 'requests', 'mobile')), ['3']);
});

test('the recommended section holds only what the member can join outright', () => {
  const rows = [
    row({ id: 'easy' }),
    row({ id: 'gated', can_join: false }),
    row({ id: 'also-easy' }),
  ];
  const { recommended, rest } = splitExploreRows(visibleExploreRows(rows, 'all', ''));

  assert.deepEqual(ids(recommended), ['easy', 'also-easy']);
  assert.deepEqual(ids(rest), ['gated']);
});
