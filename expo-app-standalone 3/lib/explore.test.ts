/**
 * Tests for the pure explore module — the tab rules and the recommended/rest
 * split shared with the web Explore page.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPLORE_TABS,
  memberCountLabel,
  splitExploreRows,
  visibleExploreRows,
  type ExploreCommunity,
} from './explore';

function community(overrides: Partial<ExploreCommunity> = {}): ExploreCommunity {
  return {
    id: 'c1',
    name: 'Design Systems',
    type: 'user',
    image_url: null,
    description: null,
    is_private: false,
    member_count: 12,
    joined: false,
    can_join: true,
    has_pending_request: false,
    ...overrides,
  };
}

test('tab order is the contract: privacy filters, then Requests sent', () => {
  assert.deepEqual(
    EXPLORE_TABS.map((tab) => tab.value),
    ['all', 'public', 'private', 'requests'],
  );
});

test('browse tabs hide joined rows and profile-mirror communities', () => {
  const rows = [
    community({ id: 'a', name: 'Alpha' }),
    community({ id: 'joined', name: 'Joined', joined: true }),
    community({ id: 'city', name: 'Bengaluru', type: 'city' }),
    community({ id: 'sector', name: 'Fintech', type: 'sector' }),
  ];

  assert.deepEqual(
    visibleExploreRows(rows, 'all', '').map((c) => c.id),
    ['a'],
  );
});

test('public narrows to non-private rows and private to private rows', () => {
  const rows = [
    community({ id: 'pub', name: 'Pub' }),
    community({ id: 'priv', name: 'Priv', is_private: true }),
  ];

  assert.deepEqual(visibleExploreRows(rows, 'public', '').map((c) => c.id), ['pub']);
  assert.deepEqual(visibleExploreRows(rows, 'private', '').map((c) => c.id), ['priv']);
  assert.deepEqual(visibleExploreRows(rows, 'all', '').map((c) => c.id), ['pub', 'priv']);
});

test('requests tab lists the member\u2019s own pending requests regardless of privacy', () => {
  const rows = [
    community({ id: 'pending-pub', has_pending_request: true }),
    community({ id: 'pending-priv', has_pending_request: true, is_private: true }),
    community({ id: 'plain' }),
  ];

  assert.deepEqual(
    visibleExploreRows(rows, 'requests', '').map((c) => c.id),
    ['pending-pub', 'pending-priv'],
  );
});

test('search matches a name substring case-insensitively on every tab', () => {
  const rows = [
    community({ id: 'a', name: 'Design Systems' }),
    community({ id: 'b', name: 'UX Research' }),
    community({ id: 'c', name: 'Design Ops', has_pending_request: true }),
  ];

  // Pending rows stay listed on the browse tabs (as "Request sent"), so the
  // "design" search finds both Design rows there.
  assert.deepEqual(visibleExploreRows(rows, 'all', 'design').map((c) => c.id), ['a', 'c']);
  assert.deepEqual(visibleExploreRows(rows, 'all', 'systems').map((c) => c.id), ['a']);
  assert.deepEqual(visibleExploreRows(rows, 'requests', 'DES').map((c) => c.id), ['c']);
});

test('splits by can_join: recommended first, locked rows under the rest', () => {
  const rows = [
    community({ id: 'open' }),
    community({ id: 'locked', can_join: false }),
  ];

  const { recommended, rest } = splitExploreRows(rows);
  assert.deepEqual(recommended.map((c) => c.id), ['open']);
  assert.deepEqual(rest.map((c) => c.id), ['locked']);
});

test('member count label pluralizes and formats', () => {
  assert.equal(memberCountLabel(1), '1 member');
  assert.equal(memberCountLabel(1234), '1,234 members');
});
