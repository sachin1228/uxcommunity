import test from "node:test";
import assert from "node:assert/strict";

import {
  R2_CREDENTIAL_HINT,
  R2CredentialError,
  classifyR2Failure,
  sendR2Command,
} from "./r2";

/**
 * The failure that took every upload route down on 2026-10-09, shaped exactly
 * the way the AWS SDK surfaced it in the Worker logs: a bare 401 with no
 * request id and no detail beyond `Unauthorized`.
 */
// `Object.assign` rather than `error.$metadata = …`: an `Error` has no such
// property, and the SDK adds it at runtime, so the shape has to be built in one
// expression for the type checker to agree with what the SDK actually throws.
function sdkError(name: string, status: number) {
  return Object.assign(new Error(`${name}: ${name}`), {
    name,
    $metadata: { httpStatusCode: status, attempts: 1 },
  });
}

function unauthorizedError() {
  return sdkError("Unauthorized", 401);
}

function s3Error(name: string, status: number) {
  return sdkError(name, status);
}

test("classifyR2Failure treats every rejected-credential shape as a credential problem", () => {
  // 401 Unauthorized is what a revoked key, a rolled secret and a key from
  // another account all answer — R2 does not tell them apart.
  assert.equal(classifyR2Failure(unauthorizedError()).credential, true);
  assert.equal(classifyR2Failure(unauthorizedError()).status, 401);

  // 403: the credential authenticated and was refused per object (a read-only
  // token), which is just as fatal for uploads.
  assert.equal(classifyR2Failure(s3Error("AccessDenied", 403)).credential, true);
  assert.equal(classifyR2Failure(s3Error("SignatureDoesNotMatch", 403)).credential, true);
  assert.equal(classifyR2Failure(s3Error("InvalidAccessKeyId", 401)).credential, true);

  // SDK bodies that carry the code in the message only.
  const withoutName = new Error("The AWS Access Key Id you provided does not exist");
  withoutName.name = "InvalidAccessKeyId";
  assert.equal(classifyR2Failure(withoutName).credential, true);
});

test("classifyR2Failure leaves ordinary failures alone", () => {
  assert.equal(classifyR2Failure(s3Error("NoSuchKey", 404)).credential, false);
  assert.equal(classifyR2Failure(s3Error("InternalError", 500)).credential, false);
  assert.equal(classifyR2Failure(new Error("fetch failed")).credential, false);
  assert.equal(classifyR2Failure(undefined).credential, false);
});

test("sendR2Command passes values through and only rewrites credential failures", async () => {
  assert.equal(await sendR2Command(() => Promise.resolve(7)), 7);

  const ordinary = s3Error("NoSuchKey", 404);
  await assert.rejects(
    sendR2Command(() => Promise.reject(ordinary)),
    (error: unknown) => error === ordinary,
    "a non-credential failure must reach the caller untouched",
  );
});

test("sendR2Command raises an R2CredentialError that names the fix", async () => {
  const original = unauthorizedError();
  await assert.rejects(
    sendR2Command(() => Promise.reject(original)),
    (error: unknown) => {
      assert.ok(error instanceof R2CredentialError);
      assert.equal(error.name, "R2CredentialError");
      assert.equal(error.status, 401);
      assert.equal(error.code, "Unauthorized");
      assert.equal(error.cause, original);
      assert.ok(error.message.includes(R2_CREDENTIAL_HINT));
      assert.match(error.message, /R2_ACCESS_KEY_ID \/ R2_SECRET_ACCESS_KEY/);
      assert.match(error.message, /HTTP 401/);
      return true;
    },
  );
});
