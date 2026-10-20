import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventBrowserNotificationKey,
  shouldShowEventBrowserNotification,
} from "./browser-notifications";

test("browser notifications only fire with permission and the page away", () => {
  assert.equal(shouldShowEventBrowserNotification("granted", true), true);
  assert.equal(shouldShowEventBrowserNotification("granted", false), false);
  assert.equal(shouldShowEventBrowserNotification("default", true), false);
  assert.equal(shouldShowEventBrowserNotification("denied", true), false);
  assert.equal(shouldShowEventBrowserNotification("unsupported", true), false);
});

test("an aggregated stage is a new key; the same state is not", () => {
  const row = { id: "n-1", title: "Tomorrow: Figma", created_at: "2026-10-20T15:15:00Z" };
  assert.equal(
    eventBrowserNotificationKey(row),
    "n-1|Tomorrow: Figma|2026-10-20T15:15:00Z",
  );
  assert.notEqual(
    eventBrowserNotificationKey(row),
    eventBrowserNotificationKey({ ...row, title: "Figma is live now" }),
  );
  assert.notEqual(
    eventBrowserNotificationKey(row),
    eventBrowserNotificationKey({ ...row, created_at: "2026-10-21T03:30:00Z" }),
  );
});
