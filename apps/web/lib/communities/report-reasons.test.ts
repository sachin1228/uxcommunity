import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_REPORT_REASONS,
  ALL_REPORT_REASON_VALUES,
  COMMUNITY_REPORT_REASONS,
  CONTENT_REPORT_ENDPOINT,
  INTERACTION_REPORT_ENDPOINT,
  INTERACTION_REPORT_TYPES,
  JOB_REPORT_REASONS,
  REPORT_CONTENT_LABELS,
  REPORT_CONTENT_TYPES,
  REPORT_REASON_VALUES,
  isInteractionReportType,
  isReportReasonValidFor,
  reportEndpointFor,
  reportReasonLabel,
  reportReasonsFor,
} from "./report-reasons";

test("post and interaction report sets are disjoint", () => {
  for (const type of REPORT_CONTENT_TYPES) {
    assert.equal(isInteractionReportType(type), false, `${type} must not be an interaction type`);
  }
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(isInteractionReportType(type), true, `${type} must be an interaction type`);
  }
  assert.equal(new Set([...REPORT_CONTENT_TYPES, ...INTERACTION_REPORT_TYPES]).size, 12);
});

test("every reportable type has human-readable copy", () => {
  for (const type of [...REPORT_CONTENT_TYPES, ...INTERACTION_REPORT_TYPES]) {
    assert.ok(REPORT_CONTENT_LABELS[type], `${type} is missing from REPORT_CONTENT_LABELS`);
  }
  assert.equal(REPORT_CONTENT_LABELS.thread_comment, "comment");
  assert.equal(REPORT_CONTENT_LABELS.community_message, "message");
  assert.equal(REPORT_CONTENT_LABELS.profile, "profile");
  assert.equal(REPORT_CONTENT_LABELS.community, "community");
  assert.equal(REPORT_CONTENT_LABELS.job, "job listing");
});

test("posts go to the content queue, everything else to interactions", () => {
  for (const type of REPORT_CONTENT_TYPES) {
    assert.equal(reportEndpointFor(type), CONTENT_REPORT_ENDPOINT);
  }
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(reportEndpointFor(type), INTERACTION_REPORT_ENDPOINT);
  }
  assert.notEqual(CONTENT_REPORT_ENDPOINT, INTERACTION_REPORT_ENDPOINT);
});

test("isInteractionReportType rejects values outside both queues", () => {
  assert.equal(isInteractionReportType("dm"), false);
  assert.equal(isInteractionReportType(""), false);
});

test("communities and jobs use their own reason lists", () => {
  assert.deepEqual(
    reportReasonsFor("community").map((reason) => reason.value),
    ["inappropriate", "harassment", "spam", "impersonation", "illegal", "misinformation", "other"],
  );
  assert.deepEqual(
    reportReasonsFor("job").map((reason) => reason.value),
    [
      "misinformation",
      "scam",
      "spam",
      "discriminatory",
      "inappropriate",
      "payment_request",
      "impersonation",
      "expired",
      "other",
    ],
  );
  // Comments and profiles keep the generic post list.
  assert.deepEqual(reportReasonsFor("thread_comment"), reportReasonsFor("thread"));
  assert.deepEqual(reportReasonsFor("profile"), reportReasonsFor("thread"));
});

test("each target accepts only the reasons it offers", () => {
  assert.equal(isReportReasonValidFor("community", "impersonation"), true);
  assert.equal(isReportReasonValidFor("community", "off_topic"), false);
  assert.equal(isReportReasonValidFor("job", "payment_request"), true);
  assert.equal(isReportReasonValidFor("job", "harassment"), false);
  assert.equal(isReportReasonValidFor("thread_comment", "scam"), false);
  assert.equal(isReportReasonValidFor("comment" as never, "scam"), false);
});

test("every offered reason is in the persisted vocabulary", () => {
  for (const option of ALL_REPORT_REASONS) {
    assert.equal(ALL_REPORT_REASON_VALUES.has(option.value), true, option.value);
  }
  // The generic set stays exactly the content-report constraint's list.
  assert.equal(REPORT_REASON_VALUES.size, 8);
  // New target-specific values are present in the union.
  for (const value of ["impersonation", "illegal", "scam", "discriminatory", "payment_request", "expired"]) {
    assert.equal(ALL_REPORT_REASON_VALUES.has(value), true, value);
  }
});

test("admin reason options are deduplicated with stable labels", () => {
  const values = ALL_REPORT_REASONS.map((option) => option.value);
  assert.equal(new Set(values).size, values.length);
  assert.equal(reportReasonLabel("scam"), "Scam or fraudulent recruitment");
  assert.equal(reportReasonLabel("impersonation"), "Impersonation");
  assert.equal(reportReasonLabel("legacy_unknown"), "legacy_unknown");
  assert.equal(COMMUNITY_REPORT_REASONS.length, 7);
  assert.equal(JOB_REPORT_REASONS.length, 9);
});
