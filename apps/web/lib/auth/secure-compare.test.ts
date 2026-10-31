import assert from "node:assert/strict";
import test from "node:test";
import { secureEqual } from "./secure-compare";

test("equal strings compare true", () => {
  assert.equal(secureEqual("admin@example.test", "admin@example.test"), true);
});

test("different strings compare false, including different lengths", () => {
  assert.equal(secureEqual("short", "a much longer value"), false);
  assert.equal(secureEqual("", "x"), false);
});
