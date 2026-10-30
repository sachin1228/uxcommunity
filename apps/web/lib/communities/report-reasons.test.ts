import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTENT_REPORT_ENDPOINT,
  INTERACTION_REPORT_ENDPOINT,
  INTERACTION_REPORT_TYPES,
  REPORT_CONTENT_LABELS,
  REPORT_CONTENT_TYPES,
  isInteractionReportType,
  reportEndpointFor,
} from "./report-reasons";

test("post and interaction report sets are disjoint", () => {
  for (const type of REPORT_CONTENT_TYPES) {
    assert.equal(isInteractionReportType(type), false, `${type} must not be an interaction type`);
  }
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(isInteractionReportType(type), true, `${type} must be an interaction type`);
  }
  assert.equal(new Set([...REPORT_CONTENT_TYPES, ...INTERACTION_REPORT_TYPES]).size, 10);
});

test("every reportable type has human-readable copy", () => {
  for (const type of [...REPORT_CONTENT_TYPES, ...INTERACTION_REPORT_TYPES]) {
    assert.ok(REPORT_CONTENT_LABELS[type], `${type} is missing from REPORT_CONTENT_LABELS`);
  }
  // The interaction kinds collapse into the three nouns the modal uses.
  assert.equal(REPORT_CONTENT_LABELS.thread_comment, "comment");
  assert.equal(REPORT_CONTENT_LABELS.community_message, "message");
  assert.equal(REPORT_CONTENT_LABELS.profile, "profile");
});

test("posts go to the content queue, interactions to their own", () => {
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
