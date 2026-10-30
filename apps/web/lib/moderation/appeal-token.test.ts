import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEAL_TOKEN_TTL_DAYS,
  createAppealToken,
  verifyAppealToken,
} from "./appeal-token";

const REPORT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-30T12:00:00.000Z");

process.env.SESSION_SECRET = "test-secret";

test("a signed token round-trips the report and account", async () => {
  const token = await createAppealToken({ reportId: REPORT, userId: USER }, NOW);
  const payload = await verifyAppealToken(token, NOW + 1000);
  assert.deepEqual(payload, {
    r: REPORT,
    u: USER,
    e: NOW + APPEAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
});

test("a tampered payload fails verification", async () => {
  const token = await createAppealToken({ reportId: REPORT, userId: USER }, NOW);
  const [payload, signature] = token.split(".");
  const forged = payload.slice(0, -2) + (payload.endsWith("A") ? "BB" : "AA");
  assert.equal(await verifyAppealToken(`${forged}.${signature}`, NOW), null);
});

test("a tampered signature fails verification", async () => {
  const token = await createAppealToken({ reportId: REPORT, userId: USER }, NOW);
  assert.equal(await verifyAppealToken(`${token.slice(0, -1)}X`, NOW), null);
});

test("malformed tokens fail closed", async () => {
  for (const value of ["", ".", "abc", "abc.def.ghi", "é.é", "a".repeat(3000)]) {
    assert.equal(await verifyAppealToken(value, NOW), null, value.slice(0, 20));
  }
});

test("an expired token is rejected even though its signature is valid", async () => {
  const token = await createAppealToken({ reportId: REPORT, userId: USER }, NOW);
  const after = NOW + (APPEAL_TOKEN_TTL_DAYS + 1) * 24 * 60 * 60 * 1000;
  assert.equal(await verifyAppealToken(token, after), null);
});

test("a token signed with another secret is rejected", async () => {
  const token = await createAppealToken({ reportId: REPORT, userId: USER }, NOW);
  process.env.SESSION_SECRET = "different-secret";
  try {
    assert.equal(await verifyAppealToken(token, NOW), null);
  } finally {
    process.env.SESSION_SECRET = "test-secret";
  }
});
