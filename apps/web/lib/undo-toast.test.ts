import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UNDO_TOAST_MS,
  dismissUndoToast,
  getUndoToast,
  showUndoToast,
  subscribeUndoToast,
} from "./undo-toast";

/** Each test starts from an empty screen so the module state cannot leak. */
function clear() {
  dismissUndoToast();
  assert.equal(getUndoToast(), null);
}

test("an offer is visible with defaults until it is dismissed", () => {
  clear();
  const id = showUndoToast({ message: "You left the chat.", onAction: () => undefined });

  assert.equal(getUndoToast()?.id, id);
  assert.equal(getUndoToast()?.message, "You left the chat.");
  assert.equal(getUndoToast()?.actionLabel, "Undo");
  assert.equal(getUndoToast()?.durationMs, UNDO_TOAST_MS);

  dismissUndoToast(id);
  assert.equal(getUndoToast(), null);
});

test("a newer offer replaces the one on screen and notifies once per change", () => {
  clear();
  let notifications = 0;
  const unsubscribe = subscribeUndoToast(() => {
    notifications += 1;
  });

  showUndoToast({ message: "First", onAction: () => undefined });
  showUndoToast({ message: "Second", onAction: () => undefined });

  assert.equal(getUndoToast()?.message, "Second");
  assert.equal(notifications, 2);
  unsubscribe();
  clear();
});

test("a stale countdown cannot dismiss the offer that replaced it", () => {
  clear();
  // The bug this guards: the first offer's timer fires after a second offer
  // took its place, and the member loses the undo they were reading.
  const first = showUndoToast({ message: "First", onAction: () => undefined });
  const second = showUndoToast({ message: "Second", onAction: () => undefined });
  assert.notEqual(first, second);

  dismissUndoToast(first);
  assert.equal(getUndoToast()?.message, "Second", "the newer offer survives");

  dismissUndoToast(second);
  assert.equal(getUndoToast(), null, "its own countdown still clears it");
});

test("without an id, dismissal clears whatever is showing", () => {
  clear();
  showUndoToast({ message: "Only one", onAction: () => undefined });
  dismissUndoToast();
  assert.equal(getUndoToast(), null);
  // Dismissing an empty screen is a no-op rather than an error.
  dismissUndoToast();
  assert.equal(getUndoToast(), null);
});

test("an offer carries its action and per-offer options", async () => {
  clear();
  let undone = 0;
  const id = showUndoToast({
    message: "You're no longer going.",
    actionLabel: "Yes, undo",
    durationMs: 2500,
    onAction: () => {
      undone += 1;
    },
  });

  const toast = getUndoToast();
  assert.equal(toast?.actionLabel, "Yes, undo");
  assert.equal(toast?.durationMs, 2500);

  await toast?.onAction();
  assert.equal(undone, 1);

  dismissUndoToast(id);
  assert.equal(getUndoToast(), null);
});
