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

test("new accounts may write during the admin grace window", () => {
  for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
    assert.equal(
      check({ status: "unverified", createdAt: created(0.1), graceDays: 30, now: NOW }),
      false,
    );
  }
});

test("the gate starts when the grace window closes", () => {
  for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
    assert.equal(
      check({ status: "unverified", createdAt: created(10), graceDays: 10, now: NOW }),
      true,
    );
    assert.equal(
      check({ status: "unverified", createdAt: created(9.9), graceDays: 10, now: NOW }),
      false,
    );
  }
});

test("zero grace applies the read-only gate immediately", () => {
  for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
    assert.equal(
      check({ status: "unverified", createdAt: created(0), graceDays: 0, now: NOW }),
      true,
    );
  }
});

test("pending and rejected accounts follow the same signup window", () => {
  for (const status of ["pending", "rejected"]) {
    for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
      assert.equal(check({ status, createdAt: created(1), graceDays: 10, now: NOW }), false);
      assert.equal(check({ status, createdAt: created(11), graceDays: 10, now: NOW }), true);
    }
  }
});

test("approved accounts are never restricted", () => {
  for (const check of [isVerificationBannerVisible, isVerificationRestricted]) {
    assert.equal(check({ status: "approved", createdAt: created(0), graceDays: 0, now: NOW }), false);
    assert.equal(check({ status: "approved", createdAt: created(30), graceDays: 10, now: NOW }), false);
  }
});

test("unknown status or signup date fails closed once the window is unknown", () => {
  assert.equal(
    isVerificationRestricted({ status: null, createdAt: created(1), graceDays: 10, now: NOW }),
    true,
  );
  assert.equal(
    isVerificationBannerVisible({ status: null, createdAt: created(1), graceDays: 10, now: NOW }),
    false,
  );
  assert.equal(
    isVerificationRestricted({ status: "unverified", createdAt: null, graceDays: 10, now: NOW }),
    true,
  );
});

test("verificationEligibleAt measures the window from signup", () => {
  assert.equal(verificationEligibleAt(created(2), 3), NOW - 2 * DAY + 3 * DAY);
});
