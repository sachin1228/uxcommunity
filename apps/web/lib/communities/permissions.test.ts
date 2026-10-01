import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_COMMUNITY_PERMISSIONS,
  COMMUNITY_PERMISSION_KEYS,
  MODERATOR_DEFAULT_PERMISSIONS,
  MODERATOR_PERMISSION_OPTIONS,
  NO_COMMUNITY_PERMISSIONS,
  applyCommunityPermissionPatch,
  hasAnyCommunityPermission,
} from "./permissions";

test("the three presets cover every permission key", () => {
  for (const key of COMMUNITY_PERMISSION_KEYS) {
    assert.equal(typeof ALL_COMMUNITY_PERMISSIONS[key], "boolean");
    assert.equal(typeof NO_COMMUNITY_PERMISSIONS[key], "boolean");
    assert.equal(typeof MODERATOR_DEFAULT_PERMISSIONS[key], "boolean");
  }
});

// A promoted moderator moderates content but cannot administrate the
// community — trimming either side is the owner's call.
test("the moderator default moderates content and withholds administration", () => {
  assert.equal(MODERATOR_DEFAULT_PERMISSIONS.can_delete_messages, true);
  assert.equal(MODERATOR_DEFAULT_PERMISSIONS.can_moderate_threads, true);
  assert.equal(MODERATOR_DEFAULT_PERMISSIONS.can_moderate_showcase, true);
  assert.equal(MODERATOR_DEFAULT_PERMISSIONS.can_moderate_resources, true);
  assert.equal(MODERATOR_DEFAULT_PERMISSIONS.can_moderate_events, true);
  assert.equal(MODERATOR_DEFAULT_PERMISSIONS.can_manage_members, false);
  assert.equal(MODERATOR_DEFAULT_PERMISSIONS.can_edit_settings, false);
});

test("hasAnyCommunityPermission is false only for the empty set", () => {
  assert.equal(hasAnyCommunityPermission(NO_COMMUNITY_PERMISSIONS), false);
  assert.equal(hasAnyCommunityPermission(ALL_COMMUNITY_PERMISSIONS), true);
  assert.equal(hasAnyCommunityPermission(MODERATOR_DEFAULT_PERMISSIONS), true);
  assert.equal(
    hasAnyCommunityPermission({ ...NO_COMMUNITY_PERMISSIONS, can_moderate_threads: true }),
    true,
  );
});

test("a patch applies onto the base without mutating it", () => {
  const next = applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, {
    can_moderate_threads: true,
  });
  assert.deepEqual(next, { ...NO_COMMUNITY_PERMISSIONS, can_moderate_threads: true });
  assert.equal(NO_COMMUNITY_PERMISSIONS.can_moderate_threads, false);
});

test("a patch clears a granted permission as well as setting one", () => {
  const next = applyCommunityPermissionPatch(ALL_COMMUNITY_PERMISSIONS, {
    can_manage_members: false,
  });
  assert.equal(next?.can_manage_members, false);
  assert.equal(next?.can_edit_settings, true);
});

test("unknown keys are ignored", () => {
  const next = applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, {
    can_everything: true,
    is_owner: true,
  });
  assert.deepEqual(next, NO_COMMUNITY_PERMISSIONS);
});

// Non-boolean values on known keys are refused outright so the API can answer
// 422 rather than silently coercing e.g. the string "false" to true.
test("a known key with a non-boolean value rejects the whole patch", () => {
  assert.equal(
    applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, { can_moderate_threads: "yes" }),
    null,
  );
  assert.equal(
    applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, { can_moderate_threads: 1 }),
    null,
  );
  assert.equal(
    applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, { can_moderate_threads: null }),
    null,
  );
});

test("a patch that is not a plain object is refused", () => {
  assert.equal(applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, null), null);
  assert.equal(applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, true), null);
  assert.equal(applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, [true]), null);
  assert.equal(applyCommunityPermissionPatch(NO_COMMUNITY_PERMISSIONS, "can_moderate_threads"), null);
});

test("an empty patch copies the base", () => {
  assert.deepEqual(applyCommunityPermissionPatch(MODERATOR_DEFAULT_PERMISSIONS, {}), {
    ...MODERATOR_DEFAULT_PERMISSIONS,
  });
});

test("every permission key has exactly one toggle option", () => {
  const optionKeys = MODERATOR_PERMISSION_OPTIONS.map((option) => option.key);
  assert.equal(optionKeys.length, COMMUNITY_PERMISSION_KEYS.length);
  assert.deepEqual([...optionKeys].sort(), [...COMMUNITY_PERMISSION_KEYS].sort());
});
