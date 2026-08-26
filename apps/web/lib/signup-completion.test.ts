import assert from "node:assert/strict";
import test from "node:test";
import { completeSignupSchema } from "./validations";

const completePayload = {
  identity: {
    name: "Ada Lovelace",
    email: "ada@example.org",
    password: "analytical1",
    confirm_password: "analytical1",
  },
  profile: {
    city_id: "22222222-2222-4222-8222-222222222222",
    sector_id: "33333333-3333-4333-8333-333333333333",
    experience_level: "senior",
  },
  interest_ids: ["44444444-4444-4444-8444-444444444444"],
  avatar_url: "https://images.example.test/profiles/ada.jpg",
  avatar_source: "upload" as const,
};

test("final signup requires identity, profile, and interests", () => {
  for (const key of ["identity", "profile", "interest_ids"] as const) {
    const abandoned = { ...completePayload } as Record<string, unknown>;
    delete abandoned[key];
    assert.equal(completeSignupSchema.safeParse(abandoned).success, false);
  }
});

test("direct completion accepts a complete payload without an invitation", () => {
  assert.equal(completeSignupSchema.safeParse(completePayload).success, true);
});

test("invitation completion accepts a complete payload with a token", () => {
  assert.equal(
    completeSignupSchema.safeParse({ ...completePayload, token: "secure-invitation-token" }).success,
    true
  );
});

test("completion rejects mismatched passwords and malformed references", () => {
  assert.equal(
    completeSignupSchema.safeParse({
      ...completePayload,
      identity: { ...completePayload.identity, confirm_password: "different1" },
    }).success,
    false
  );
  assert.equal(
    completeSignupSchema.safeParse({
      ...completePayload,
      profile: { ...completePayload.profile, city_id: "not-a-uuid" },
    }).success,
    false
  );
});
