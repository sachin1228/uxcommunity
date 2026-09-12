import assert from "node:assert/strict";
import test from "node:test";
import { isSignupIncomplete } from "./signup-status";

test("a profile without an uploaded picture is a completed signup", () => {
  // Regression: login used to require `profile.avatar_url`, which locked out
  // every member who skipped the optional picture step (and everyone whose
  // generated avatar was nulled by the 20260826 migration).
  assert.equal(isSignupIncomplete({ id: "profile-1", avatar_url: null }), false);
  assert.equal(isSignupIncomplete({ id: "profile-1" }), false);
});

test("a profile with an uploaded picture is a completed signup", () => {
  assert.equal(
    isSignupIncomplete({ id: "profile-1", avatar_url: "https://cdn.example.test/a.jpg" }),
    false
  );
});

test("a missing designer profile is an incomplete signup", () => {
  assert.equal(isSignupIncomplete(null), true);
  assert.equal(isSignupIncomplete(undefined), true);
});
