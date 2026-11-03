import assert from "node:assert/strict";
import test from "node:test";
import { mergeContentEventSnapshot } from "./content-event-snapshot";

test("delayed history preserves live inserts/reactions and cannot resurrect deleted cards", () => {
  const old = { id: "a", created_at: "2026-01-01T00:00:00Z", reactions: 0 };
  const deleted = { ...old, id: "deleted" };
  const live = { ...old, reactions: 2 };
  const inserted = { ...old, id: "new", created_at: "2026-01-02T00:00:00Z" };
  const result = mergeContentEventSnapshot([old, deleted], [inserted, live], new Set(["deleted"]));
  assert.deepEqual(result, [live, inserted]);
  assert.equal(result[0], live);
});
