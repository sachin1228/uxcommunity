import { test } from "node:test";
import assert from "node:assert/strict";
import { generateRoomCode, normalizeRoomCode } from "./roomCode";

test("generated codes have 5 unambiguous chars", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, 5);
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
  }
});

test("normalize accepts and uppercases clean input", () => {
  assert.equal(normalizeRoomCode("crabs"), "CRABS");
  assert.equal(normalizeRoomCode("  cr-abs 2 "), "CRABS");
});

test("normalize strips 0, O, 1, I (ambiguous)", () => {
  assert.equal(normalizeRoomCode("0O1I2345"), null);
  assert.equal(normalizeRoomCode("A0B1C2D3E"), null);
});

test("normalize rejects short codes and trims long ones", () => {
  assert.equal(normalizeRoomCode("AB"), null);
  assert.equal(normalizeRoomCode("BEARSX"), "BEARS");
  assert.equal(normalizeRoomCode(""), null);
});
