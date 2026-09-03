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

test("completion rejects mismatched passwords", () => {
  assert.equal(
    completeSignupSchema.safeParse({
      ...completePayload,
      identity: { ...completePayload.identity, confirm_password: "different1" },
    }).success,
    false
  );
});

test("completion requires both a name and a surname", () => {
  assert.equal(
    completeSignupSchema.safeParse({
      ...completePayload,
      identity: { ...completePayload.identity, name: "Sachin" },
    }).success,
    false
  );
  assert.equal(
    completeSignupSchema.safeParse({
      ...completePayload,
      identity: { ...completePayload.identity, name: "Sachin Patil" },
    }).success,
    true
  );
});

test("completion allows at most five interests", () => {
  const interestIds = [
    "44444444-4444-4444-8444-444444444441",
    "44444444-4444-4444-8444-444444444442",
    "44444444-4444-4444-8444-444444444443",
    "44444444-4444-4444-8444-444444444444",
    "44444444-4444-4444-8444-444444444445",
  ];
  assert.equal(
    completeSignupSchema.safeParse({ ...completePayload, interest_ids: interestIds }).success,
    true
  );
  assert.equal(
    completeSignupSchema.safeParse({
      ...completePayload,
      interest_ids: [...interestIds, "44444444-4444-4444-8444-444444444446"],
    }).success,
    false
  );
});
