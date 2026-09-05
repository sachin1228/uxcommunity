import assert from "node:assert/strict"
import test from "node:test"

import bcrypt from "bcryptjs"

import { hashPassword, needsPasswordRehash, PASSWORD_HASH_COST } from "./password"

test("hashPassword stores the current cost and verifies", async () => {
  const hash = await hashPassword("correct horse battery staple 1")

  assert.equal(bcrypt.getRounds(hash), PASSWORD_HASH_COST)
  assert.equal(await bcrypt.compare("correct horse battery staple 1", hash), true)
  assert.equal(await bcrypt.compare("wrong password", hash), false)
})

test("needsPasswordRehash flags older higher-cost hashes", async () => {
  // Simulate a hash created before the cost was lowered (e.g. the previous
  // cost-12 signup hashes still stored for existing users).
  const oldHash = await bcrypt.hash("correct horse battery staple 1", 12)

  assert.equal(needsPasswordRehash(oldHash), true)
})

test("needsPasswordRehash accepts hashes at or below the current cost", async () => {
  const current = await hashPassword("correct horse battery staple 1")
  const lower = await bcrypt.hash("correct horse battery staple 1", PASSWORD_HASH_COST - 1)

  assert.equal(needsPasswordRehash(current), false)
  assert.equal(needsPasswordRehash(lower), false)
})

test("needsPasswordRehash never throws on malformed input", () => {
  assert.equal(needsPasswordRehash(""), false)
  assert.equal(needsPasswordRehash("not-a-hash"), false)
  assert.equal(needsPasswordRehash("$2b$xx$whatever"), false)
})
