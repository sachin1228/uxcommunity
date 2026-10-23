import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inAppBrowserNotificationKey,
  shouldShowInAppBrowserNotification,
} from "./notifications-browser";

test("browser notifications only fire with permission and the page away", () => {
  assert.equal(shouldShowInAppBrowserNotification("granted", true), true);
  assert.equal(shouldShowInAppBrowserNotification("granted", false), false);
  assert.equal(shouldShowInAppBrowserNotification("default", true), false);
  assert.equal(shouldShowInAppBrowserNotification("denied", true), false);
  assert.equal(shouldShowInAppBrowserNotification("unsupported", true), false);
});

test("an aggregated row is a new key; the same state is not", () => {
  const row = { id: "n-1", title: "John liked your thread", created_at: "2026-10-20T15:15:00Z" };
  assert.equal(
    inAppBrowserNotificationKey(row),
    "n-1|John liked your thread|2026-10-20T15:15:00Z",
  );
  assert.notEqual(
    inAppBrowserNotificationKey(row),
    inAppBrowserNotificationKey({ ...row, title: "John and 2 others liked your thread" }),
  );
  assert.notEqual(
    inAppBrowserNotificationKey(row),
    inAppBrowserNotificationKey({ ...row, created_at: "2026-10-21T03:30:00Z" }),
  );
});
