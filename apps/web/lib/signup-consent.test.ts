import test from "node:test";
import assert from "node:assert/strict";

import { completeSignupSchema, directSignupStep1Schema } from "./validations";

const identity = {
  name: "Ada Lovelace",
  email: "ada@example.org",
  password: "analytical1",
  confirm_password: "analytical1",
  age_confirmed: true,
  terms_accepted: true,
};

test("a complete identity with both consent flags passes", () => {
  assert.equal(directSignupStep1Schema.safeParse(identity).success, true);
});

test("the age confirmation is required", () => {
  for (const value of [false, undefined]) {
    const result = directSignupStep1Schema.safeParse({ ...identity, age_confirmed: value });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.issues[0].message, /18 or older/);
    }
  }
});

test("terms acceptance is required", () => {
  for (const value of [false, undefined]) {
    const result = directSignupStep1Schema.safeParse({ ...identity, terms_accepted: value });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.issues[0].message, /Terms of Service|Privacy Policy/);
    }
  }
});

test("both missing flags are reported together", () => {
  const result = directSignupStep1Schema.safeParse({
    ...identity,
    age_confirmed: false,
    terms_accepted: false,
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    assert.ok(fields.age_confirmed?.length);
    assert.ok(fields.terms_accepted?.length);
  }
});

test("account creation rejects an identity without consent", () => {
  const payload = {
    identity,
    profile: {
      city_id: "22222222-2222-4222-8222-222222222222",
      sector_id: "33333333-3333-4333-8333-333333333333",
      experience_level: "senior",
      job_title: "product_designer",
    },
    avatar_url: "https://images.example.test/profiles/ada.jpg",
    avatar_source: "upload",
  };

  assert.equal(completeSignupSchema.safeParse(payload).success, true);

  const withoutConsent = {
    name: identity.name,
    email: identity.email,
    password: identity.password,
    confirm_password: identity.confirm_password,
  };
  assert.equal(
    completeSignupSchema.safeParse({ ...payload, identity: withoutConsent }).success,
    false,
  );
});
