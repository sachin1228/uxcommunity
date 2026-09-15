import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chosenAreas,
  COMMUNITY_AREAS,
  isAreaConfigurable,
  isAreaVisible,
} from "./areas";

const LEGACY_TABS = ["chat", "threads", "events", "resources"];

// The regression this guards: Showcase shipped as an unconditional tab that was
// never written to enabled_tabs, so every community created before the toggle
// has an array without it. Falling back to the array alone hid the tab.
test("a public community always shows Showcase, even when enabled_tabs omits it", () => {
  assert.equal(isAreaVisible("showcase", LEGACY_TABS, false), true);
  assert.equal(isAreaVisible("showcase", null, false), true);
  assert.equal(isAreaVisible("showcase", undefined, undefined), true);
});

test("a public community cannot choose Showcase, and does not store it", () => {
  assert.equal(isAreaConfigurable("showcase", false), false);
  assert.deepEqual(chosenAreas(LEGACY_TABS, false), ["chat", "threads", "events", "resources"]);
  // Even if a row still carries it (e.g. from the backfill), saving drops it.
  assert.deepEqual(chosenAreas(["chat", "threads", "showcase", "events", "resources"], false), [
    "chat",
    "threads",
    "events",
    "resources",
  ]);
});

test("a private community follows its own choice for Showcase", () => {
  assert.equal(isAreaConfigurable("showcase", true), true);
  assert.equal(isAreaVisible("showcase", LEGACY_TABS, true), false);
  assert.equal(isAreaVisible("showcase", [...LEGACY_TABS, "showcase"], true), true);
});

test("the other areas follow enabled_tabs for both privacies", () => {
  for (const isPrivate of [true, false]) {
    assert.equal(isAreaVisible("threads", ["chat", "threads"], isPrivate), true);
    assert.equal(isAreaVisible("events", ["chat", "threads"], isPrivate), false);
    assert.equal(isAreaVisible("resources", LEGACY_TABS, isPrivate), true);
    assert.equal(isAreaConfigurable("threads", isPrivate), true);
    assert.equal(isAreaConfigurable("events", isPrivate), true);
  }
});

test("chat is always present, whoever the community is", () => {
  for (const isPrivate of [true, false]) {
    assert.equal(isAreaVisible("chat", ["chat"], isPrivate), true);
    assert.equal(isAreaVisible("chat", ["chat"], isPrivate), true);
  }
});

test("chosenAreas returns nav order and ignores unknown or duplicate values", () => {
  assert.deepEqual(chosenAreas(["resources", "chat", "chat", "nope", "threads"], true), [
    "chat",
    "threads",
    "resources",
  ]);
});

test("a community with no stored areas gets every default area", () => {
  for (const isPrivate of [true, false]) {
    for (const area of COMMUNITY_AREAS) {
      assert.equal(isAreaVisible(area, null, isPrivate), true, `${area} (isPrivate: ${isPrivate})`);
    }
  }
});
