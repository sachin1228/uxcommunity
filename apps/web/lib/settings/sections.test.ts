import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SETTINGS_SECTION_HREFS, SETTINGS_SECTIONS } from "./sections";

/**
 * The Settings index is a hand-written list of links whose only way in is that
 * list, so the failure it can ship silently is a row pointing at a route that
 * does not exist — a 404 nobody sees until a member taps it. The route's loading
 * boundary is hand-written too, one file per page, and a page that loses its
 * boundary degrades quietly to a blank column rather than failing loudly. These
 * tests walk the app tree to prove every row has both, and pin the list's shape
 * so a duplicated href or an unlabelled row cannot slip through.
 */

const SETTINGS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "app",
  "dashboard",
  "settings",
);

test("every settings row opens a page that exists", () => {
  for (const section of SETTINGS_SECTIONS) {
    const segment = section.href.replace("/dashboard/settings/", "");
    const page = path.join(SETTINGS_DIR, segment, "page.tsx");
    assert.ok(existsSync(page), `missing page for ${section.label}: ${section.href}`);
  }
});

test("the settings index is itself a route", () => {
  assert.ok(existsSync(path.join(SETTINGS_DIR, "page.tsx")));
});

test("every settings route has a loading boundary", () => {
  assert.ok(
    existsSync(path.join(SETTINGS_DIR, "loading.tsx")),
    "the settings index has no loading boundary",
  );

  for (const section of SETTINGS_SECTIONS) {
    const segment = section.href.replace("/dashboard/settings/", "");
    assert.ok(
      existsSync(path.join(SETTINGS_DIR, segment, "loading.tsx")),
      `no loading boundary for ${section.label}`,
    );
  }
});

test("settings rows are unique and fully labelled", () => {
  const labels = SETTINGS_SECTIONS.map((section) => section.label);
  assert.equal(new Set(labels).size, labels.length, "duplicate row label");

  // The rendered rows must cover the declared href union exactly, in order, so
  // the icon map (keyed by that union) and the list can never drift apart.
  assert.deepEqual(
    SETTINGS_SECTIONS.map((section) => section.href),
    [...SETTINGS_SECTION_HREFS],
    "the rendered rows must cover every declared href",
  );

  for (const section of SETTINGS_SECTIONS) {
    assert.ok(section.label.trim(), "row without a label");
    assert.ok(section.description.trim(), `row without a description: ${section.label}`);
  }
});
