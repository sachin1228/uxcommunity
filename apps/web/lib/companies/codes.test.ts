import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VERIFICATION_CODE_LENGTH,
  generateVerificationCode,
  hashVerificationCode,
  isVerificationCode,
} from "./codes";

/**
 * The code that proves a member controls a work mailbox. Only its hash is
 * stored, and the database compares hashes, so the two properties that matter
 * here are: a code is unpredictable and the hash is stable for the same code
 * and environment (otherwise nobody could ever verify).
 */

test("codes are numeric, correctly padded, and not obviously repeating", () => {
  const codes = Array.from({ length: 200 }, () => generateVerificationCode());

  for (const code of codes) {
    assert.equal(code.length, VERIFICATION_CODE_LENGTH);
    assert.match(code, /^\d+$/);
  }

  // A leading zero must survive as a leading zero.
  assert.equal(codes.every((code) => code.length === VERIFICATION_CODE_LENGTH), true);
  // Not a random draw every time, but 200 identical codes would mean the RNG
  // is not moving at all.
  assert.ok(new Set(codes).size > 1);
});

test("hashing is stable for the same code and environment", () => {
  const code = "042517";
  const first = hashVerificationCode(code);

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(hashVerificationCode(code), first);
  assert.notEqual(hashVerificationCode("042518"), first);
  // A different pepper must not produce the same hash, otherwise the stored
  // hash could be replayed across environments.
  const previous = process.env.COMPANY_VERIFICATION_PEPPER;
  process.env.COMPANY_VERIFICATION_PEPPER = "another-pepper";
  assert.notEqual(hashVerificationCode(code), first);
  if (previous === undefined) delete process.env.COMPANY_VERIFICATION_PEPPER;
  else process.env.COMPANY_VERIFICATION_PEPPER = previous;
});

test("only a full numeric code is a code", () => {
  assert.equal(isVerificationCode("000000"), true);
  assert.equal(isVerificationCode("123456"), true);
  assert.equal(isVerificationCode("12345"), false);
  assert.equal(isVerificationCode("1234567"), false);
  assert.equal(isVerificationCode("12345a"), false);
  assert.equal(isVerificationCode(""), false);
  assert.equal(isVerificationCode(123456), false);
  assert.equal(isVerificationCode(null), false);
});
