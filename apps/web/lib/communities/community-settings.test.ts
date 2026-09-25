import assert from "node:assert/strict";
import { test } from "node:test";
import { openCommunitySettings, registerCommunitySettingsOpener } from "./cache";

/**
 * The settings-opener registry is how the room's info card (mounted by the
 * dashboard layout) asks the room's chat view — the component that owns the
 * settings modal — to open it. Both halves of that are worth pinning down: a
 * request has to reach exactly the view it was meant for, and the identity of
 * what is registered has to survive a remount (the new effect registers before
 * the old effect's cleanup runs, and that cleanup must not unhook it).
 */

test("a settings request reaches the view registered for that community", () => {
  let opened = 0;
  const off = registerCommunitySettingsOpener("room-a", () => { opened += 1; });

  assert.equal(openCommunitySettings("room-a"), true);
  assert.equal(opened, 1);
  // Another room's panel asking must not open this one's modal.
  assert.equal(openCommunitySettings("room-b"), false);
  assert.equal(opened, 1);

  off();
  // Nothing is mounted any more, so the caller is told so rather than answered
  // with silence (see EventRoomGoneSection, which navigates instead).
  assert.equal(openCommunitySettings("room-a"), false);
  assert.equal(opened, 1);
});

test("a remount's cleanup cannot unhook the opener that replaced it", () => {
  const first = registerCommunitySettingsOpener("room-a", () => {});
  const second = registerCommunitySettingsOpener("room-a", () => {});

  first();
  assert.equal(openCommunitySettings("room-a"), true);

  second();
  assert.equal(openCommunitySettings("room-a"), false);
});
