import test from "node:test";
import assert from "node:assert/strict";

import { parseDeleteAccountRequest } from "./delete-request";

test("a deletion request needs the password and the literal DELETE", () => {
  assert.deepEqual(parseDeleteAccountRequest({ password: "secret1", confirmation: "DELETE" }), {
    ok: true,
    password: "secret1",
  });
});

test("missing or blank passwords are refused before any comparison", () => {
  for (const body of [
    {},
    { password: "" },
    { password: 123, confirmation: "DELETE" },
    { confirmation: "DELETE" },
  ]) {
    const result = parseDeleteAccountRequest(body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Enter your password to continue.");
  }
});

test("a null or undefined body is a malformed request", () => {
  for (const body of [null, undefined]) {
    const result = parseDeleteAccountRequest(body);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, "Invalid request body.");
    }
  }
});

test("confirmation must be exactly DELETE", () => {
  for (const confirmation of ["delete", "Delete", "DELETE ", "", undefined]) {
    const result = parseDeleteAccountRequest({ password: "secret1", confirmation });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
      assert.match(result.error, /Type DELETE/);
    }
  }
});

test("a non-object body is a malformed request", () => {
  const result = parseDeleteAccountRequest("nope");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test("extra fields are ignored", () => {
  assert.deepEqual(
    parseDeleteAccountRequest({
      password: "secret1",
      confirmation: "DELETE",
      user_id: "someone-else",
    }),
    { ok: true, password: "secret1" },
  );
});
