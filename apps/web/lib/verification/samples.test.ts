import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVerificationSamplePath,
  verificationSampleCount,
  verificationSampleKey,
  verificationSampleLegacyUrl,
  verificationSamplePaths,
} from "./samples";

const REQUEST = "11111111-1111-4111-8111-111111111111";

test("proxy paths never contain the private key or the legacy URL", () => {
  const paths = verificationSamplePaths(REQUEST, {
    work_sample_keys: ["verification/u/a.png", "verification/u/b.png"],
    work_sample_urls: ["https://media.example.test/verification/u/old.png"],
  });
  assert.deepEqual(paths, [
    `/api/private/verification/${REQUEST}/0`,
    `/api/private/verification/${REQUEST}/1`,
  ]);
  assert.ok(paths.every((path) => !path.includes("verification/u/")));
  assert.ok(paths.every((path) => !path.includes("https://")));
});

test("the display count follows the longer key/URL array", () => {
  assert.equal(verificationSampleCount({ work_sample_keys: ["a"], work_sample_urls: [] }), 1);
  assert.equal(verificationSampleCount({ work_sample_keys: [], work_sample_urls: ["u", "v"] }), 2);
  assert.equal(verificationSampleCount({}), 0);
});

test("key and legacy accessors resolve by index without exposing the other form", () => {
  const row = {
    work_sample_keys: ["verification/u/a.png"],
    work_sample_urls: ["https://media.example.test/verification/u/old.png"],
  };
  assert.equal(verificationSampleKey(row, 0), "verification/u/a.png");
  assert.equal(verificationSampleKey(row, 1), null);
  assert.equal(verificationSampleLegacyUrl(row, 0), "https://media.example.test/verification/u/old.png");
  assert.equal(verificationSampleLegacyUrl(row, 1), null);
});

test("proxy paths round-trip through the parser", () => {
  assert.deepEqual(parseVerificationSamplePath(`/api/private/verification/${REQUEST}/2`), {
    requestId: REQUEST,
    index: 2,
  });
  assert.equal(parseVerificationSamplePath(`/api/private/verification/${REQUEST}/x`), null);
  assert.equal(parseVerificationSamplePath(`/api/private/verification/not-a-uuid/0`), null);
  assert.equal(parseVerificationSamplePath("https://media.example.test/verification/u/a.png"), null);
  assert.equal(parseVerificationSamplePath(`/api/private/verification/${REQUEST}/0/extra`), null);
});
