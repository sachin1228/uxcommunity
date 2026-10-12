import assert from "node:assert/strict";
import { test } from "node:test";
import { membershipPushPlan, type MembershipPreferences } from "./membership-preferences";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./preferences";

function prefs(overrides: Partial<MembershipPreferences> = {}): MembershipPreferences {
  return {
    community_push_enabled: true,
    chat_sound: "default",
    quiet_hours_enabled: false,
    quiet_hours_start: "22:00",
    quiet_hours_end: "07:00",
    quiet_hours_timezone: "UTC",
    ...overrides,
  };
}

/** 12:00 UTC — outside the default 22:00–07:00 quiet window. */
const NOON = new Date("2026-10-12T12:00:00Z");
/** 23:00 UTC — inside the default quiet window. */
const NIGHT = new Date("2026-10-12T23:00:00Z");

test("defaults keep community updates on", () => {
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.community_push_enabled, true);
});

test("a member who never saved preferences still gets an audible update", () => {
  assert.deepEqual(membershipPushPlan(undefined, NOON), { send: true, audible: true });
});

test("the community-updates switch off suppresses the push entirely", () => {
  assert.deepEqual(
    membershipPushPlan(prefs({ community_push_enabled: false }), NOON),
    { send: false, audible: false },
  );
});

test("the chat master switch does not govern community updates", () => {
  // `chat_push_enabled` is not in this row at all; community updates stand on
  // their own switch, which is what the settings screen promises.
  assert.deepEqual(
    membershipPushPlan(prefs({ chat_sound: "default" }), NOON),
    { send: true, audible: true },
  );
});

test("quiet hours silence the push instead of suppressing it", () => {
  assert.deepEqual(
    membershipPushPlan(prefs({ quiet_hours_enabled: true }), NIGHT),
    { send: true, audible: false },
  );
});

test("the silent sound choice keeps the push but drops the buzz", () => {
  assert.deepEqual(
    membershipPushPlan(prefs({ chat_sound: "silent" }), NOON),
    { send: true, audible: false },
  );
});
