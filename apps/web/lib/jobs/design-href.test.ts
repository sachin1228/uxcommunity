import assert from "node:assert/strict";
import { test } from "node:test";
import { designModeHref } from "./design-href";
import type { JobApplicant } from "./types";

function applicant(id: string): JobApplicant {
  return {
    id,
    applicant_id: `user-${id}`,
    name: `Applicant ${id}`,
    portfolio_url: `https://example.com/${id}`,
    linkedin_url: `https://linkedin.com/in/${id}`,
    resume_url: null,
    created_at: "2026-10-09T12:00:00Z",
    avatar_url: null,
    status: "new",
    applied_label: "1d ago",
  };
}

test("an empty posting yields no design link instead of throwing", () => {
  // The board renders this state whenever a posting has no applications yet,
  // or when the applicant read degrades to an empty list.
  assert.equal(designModeHref("job-1", [], []), null);
});

test("the link opens the first application in the tab being viewed", () => {
  const board = [applicant("a"), applicant("b")];
  assert.equal(designModeHref("job-1", board, board), "/applications/job-1/a");
});

test("an emptied tab falls back to the whole list", () => {
  const board = [applicant("a"), applicant("b")];
  assert.equal(designModeHref("job-1", [], board), "/applications/job-1/a");
});
