import assert from "node:assert/strict";
import test from "node:test";
import { deleteCredentialSchema } from "./delete-credential";

test("valid deletion credentials parse", () => {
  assert.equal(
    deleteCredentialSchema.safeParse({
      email: "member@example.test",
      password: "secret",
      confirmation: "DELETE",
    }).success,
    true,
  );
});

test("missing confirmation or a different literal is rejected", () => {
  assert.equal(
    deleteCredentialSchema.safeParse({
      email: "member@example.test",
      password: "secret",
      confirmation: "delete",
    }).success,
    false,
  );
});

test("invalid email is rejected", () => {
  assert.equal(
    deleteCredentialSchema.safeParse({
      email: "not-an-email",
      password: "secret",
      confirmation: "DELETE",
    }).success,
    false,
  );
});
