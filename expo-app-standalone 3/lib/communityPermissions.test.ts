import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODERATION_PERMISSION_BY_KIND,
  MODERATOR_DEFAULT_PERMISSIONS,
  NO_COMMUNITY_PERMISSIONS,
  canModerateContent,
  type CommunityPermissions,
} from './communityPermissions';

test('an owner moderates every content kind without needing a grant', () => {
  for (const kind of ['threads', 'showcase', 'resources', 'events'] as const) {
    assert.equal(canModerateContent(kind, 'owner', null), true);
    assert.equal(canModerateContent(kind, 'owner', NO_COMMUNITY_PERMISSIONS), true);
  }
});

test('plain members and missing roles never moderate', () => {
  for (const kind of ['threads', 'showcase', 'resources', 'events'] as const) {
    assert.equal(canModerateContent(kind, 'member', MODERATOR_DEFAULT_PERMISSIONS), false);
    assert.equal(canModerateContent(kind, null, MODERATOR_DEFAULT_PERMISSIONS), false);
    assert.equal(canModerateContent(kind, undefined, MODERATOR_DEFAULT_PERMISSIONS), false);
  }
});

test('a manager moderates only the kinds they were granted', () => {
  const threadsOnly: CommunityPermissions = {
    ...NO_COMMUNITY_PERMISSIONS,
    can_moderate_threads: true,
  };
  assert.equal(canModerateContent('threads', 'moderator', threadsOnly), true);
  assert.equal(canModerateContent('showcase', 'moderator', threadsOnly), false);
  assert.equal(canModerateContent('resources', 'moderator', threadsOnly), false);
  assert.equal(canModerateContent('events', 'moderator', threadsOnly), false);

  // Admins read the same row — their defaults simply grant all four.
  assert.equal(canModerateContent('events', 'admin', MODERATOR_DEFAULT_PERMISSIONS), true);
  assert.equal(canModerateContent('events', 'admin', NO_COMMUNITY_PERMISSIONS), false);
});

test('each tab reads its own moderation key', () => {
  assert.deepEqual(MODERATION_PERMISSION_BY_KIND, {
    threads: 'can_moderate_threads',
    showcase: 'can_moderate_showcase',
    resources: 'can_moderate_resources',
    events: 'can_moderate_events',
  });
});
