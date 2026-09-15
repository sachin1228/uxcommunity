import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMUNITY_FEATURES,
  isFeatureVisible,
  isShowcaseEnabled,
  toEnabledTabs,
} from "./areas";

// The regression this guards: Showcase shipped as an unconditional tab and was
// never written to enabled_tabs, so every community created before the flag
// exists stores an array without it. Reading visibility from that array hid the
// tab on all of them.
test("a community with no showcase flag still shows Showcase", () => {
  assert.equal(isShowcaseEnabled(undefined), true);
  assert.equal(isShowcaseEnabled(null), true);
  assert.equal(
    isFeatureVisible("showcase", { enabled_tabs: ["chat", "threads", "events", "resources"] }),
    true,
  );
});

test("Showcase is hidden only when a community switched it off", () => {
  assert.equal(isShowcaseEnabled(false), false);
  assert.equal(
    isFeatureVisible("showcase", { enabled_tabs: ["chat"], showcase_enabled: false }),
    false,
  );
  assert.equal(
    isFeatureVisible("showcase", { enabled_tabs: ["chat"], showcase_enabled: true }),
    true,
  );
});

test("the other areas follow enabled_tabs", () => {
  const community = { enabled_tabs: ["chat", "threads"], showcase_enabled: true };
  assert.equal(isFeatureVisible("chat", community), true);
  assert.equal(isFeatureVisible("threads", community), true);
  assert.equal(isFeatureVisible("events", community), false);
  assert.equal(isFeatureVisible("resources", community), false);
});

test("a community with no enabled_tabs falls back to every area", () => {
  for (const feature of COMMUNITY_FEATURES) {
    assert.equal(isFeatureVisible(feature, {}), true, feature);
  }
});

test("Showcase is never stored in enabled_tabs", () => {
  assert.deepEqual(toEnabledTabs(["chat", "threads", "showcase", "events"]), [
    "chat",
    "threads",
    "events",
  ]);
});

test("toEnabledTabs returns nav order and ignores unknown or duplicate values", () => {
  assert.deepEqual(toEnabledTabs(["resources", "chat", "chat", "nope", "threads"]), [
    "chat",
    "threads",
    "resources",
  ]);
});
