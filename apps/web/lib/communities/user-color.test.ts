import { test } from "node:test";
import assert from "node:assert/strict";
import { userColorIndex, userColorVar, USER_NAME_COLOR_COUNT } from "./user-color";

test("userColorIndex is deterministic for the same id", () => {
  assert.equal(userColorIndex("user-123"), userColorIndex("user-123"));
  assert.equal(userColorIndex(""), userColorIndex(""));
});

test("userColorIndex never exceeds the palette count", () => {
  for (const id of ["a", "b", "c", "user-1", "user-42", "00000000-0000-0000-0000-000000000000"]) {
    const idx = userColorIndex(id);
    assert.ok(Number.isInteger(idx));
    assert.ok(idx >= 0 && idx < USER_NAME_COLOR_COUNT, `index ${idx} out of range`);
  }
});

test("userColorIndex spreads across the palette", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) seen.add(userColorIndex(`user-${i}`));
  // With 7 colors, 200 distinct ids should hit all of them.
  assert.equal(seen.size, USER_NAME_COLOR_COUNT);
});

test("userColorVar maps to a --chat-name token for a real id", () => {
  const v = userColorVar("user-123");
  assert.match(v, /^var\(--chat-name-\d\)$/);
});

test("userColorVar falls back to muted foreground with no id", () => {
  assert.equal(userColorVar(null), "var(--color-foreground-muted)");
  assert.equal(userColorVar(undefined), "var(--color-foreground-muted)");
});
