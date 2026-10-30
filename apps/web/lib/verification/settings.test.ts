import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isVerificationBannerVisible,
  isVerificationRestricted,
  verificationEligibleAt,
} from "./policy";

const NOW = new Date("2026-10-26T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const created = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

test("policy A: an unverified account is read-only from signup", () => {
  for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
    assert.equal(
      check({ status: "unverified", createdAt: created(0), graceDays: 0, now: NOW }),
      true,
    );
    assert.equal(
      check({ status: "unverified", createdAt: created(0.1), graceDays: 30, now: NOW }),
      true,
    );
  }
});

test("approved accounts are never restricted", () => {
  for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
    assert.equal(check({ status: "approved", createdAt: created(0), graceDays: 0, now: NOW }), false);
  }
});

test("pending and rejected accounts are restricted immediately", () => {
  for (const status of ["pending", "rejected"]) {
    for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
      assert.equal(check({ status, createdAt: created(0), graceDays: 30, now: NOW }), true);
    }
  }
});

test("verificationEligibleAt remains a pure legacy helper", () => {
  assert.equal(verificationEligibleAt(created(2), 3), NOW - 2 * DAY + 3 * DAY);
});
