import test from "node:test";
import assert from "node:assert/strict";

import {
  canViewApplicationResume,
  canViewDmAsset,
  canViewSavedResume,
  canViewVerificationSample,
} from "./private-access";

const applicant = "applicant-id";
const poster = "poster-id";
const stranger = "stranger-id";

test("résumé access: applicant and that job's poster only", () => {
  const base = { applicantId: applicant, posterId: poster };

  assert.equal(canViewApplicationResume({ ...base, viewerId: applicant }), true);
  assert.equal(canViewApplicationResume({ ...base, viewerId: poster }), true);
  assert.equal(canViewApplicationResume({ ...base, viewerId: stranger }), false);

  // A different employer is not the poster of this job.
  assert.equal(
    canViewApplicationResume({ viewerId: "other-employer", applicantId: applicant, posterId: poster }),
    false,
  );

  // Admin access to résumés is deliberately not granted.
  assert.equal(
    canViewApplicationResume({ ...base, viewerId: stranger, isAdmin: true }),
    false,
  );

  // A posting whose poster row disappeared still leaves the applicant access.
  assert.equal(
    canViewApplicationResume({ viewerId: applicant, applicantId: applicant, posterId: null }),
    true,
  );
  assert.equal(
    canViewApplicationResume({ viewerId: stranger, applicantId: applicant, posterId: null }),
    false,
  );
});

test("verification samples: owner or an explicit admin session", () => {
  assert.equal(
    canViewVerificationSample({ viewerId: "owner", ownerId: "owner" }),
    true,
  );
  assert.equal(
    canViewVerificationSample({ viewerId: "someone-else", ownerId: "owner" }),
    false,
  );
  assert.equal(
    canViewVerificationSample({ viewerId: "someone-else", ownerId: "owner", isAdmin: true }),
    true,
  );
});

test("saved résumés are owner-only", () => {
  assert.equal(canViewSavedResume({ viewerId: "owner", ownerId: "owner" }), true);
  assert.equal(canViewSavedResume({ viewerId: "other", ownerId: "owner" }), false);
});

test("DM images: conversation participants, plus the explicit admin evidence path", () => {
  const participants = ["a", "b"];
  assert.equal(canViewDmAsset({ viewerId: "a", participants }), true);
  assert.equal(canViewDmAsset({ viewerId: "b", participants }), true);
  assert.equal(canViewDmAsset({ viewerId: "c", participants }), false);
  assert.equal(canViewDmAsset({ viewerId: "c", participants, isAdmin: true }), true);
  assert.equal(canViewDmAsset({ viewerId: "c", participants: [] }), false);
});
