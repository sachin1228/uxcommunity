import assert from "node:assert/strict";
import test from "node:test";
import { privateWorkSampleKeys, verificationSampleDisplayUrls } from "./samples";

const ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_PUBLIC_URL: "https://media.example.test",
  R2_PRIVATE_BUCKET_NAME: "uxcommunity-private",
};

function withEnv(fn: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("private keys are returned only as a separate owner field", () => {
  assert.deepEqual(
    privateWorkSampleKeys({ work_sample_keys: ["verification/u/a.png"] }),
    ["verification/u/a.png"],
  );
});

test("private samples become short-lived signed URLs, not raw keys", async () => {
  await withEnv(async () => {
    const urls = await verificationSampleDisplayUrls({
      work_sample_keys: ["verification/u/a.png"],
      work_sample_urls: ["https://media.example.test/verification/u/old.png"],
    });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /X-Amz-Expires=900/);
    assert.notEqual(urls[0], "verification/u/a.png");
    assert.ok(!urls[0].includes("verification/u/old.png"));
  });
});

test("legacy URL-only rows keep their legacy URL (documented migration gap)", async () => {
  await withEnv(async () => {
    const urls = await verificationSampleDisplayUrls({
      work_sample_keys: [],
      work_sample_urls: ["https://media.example.test/verification/u/old.png"],
    });
    assert.deepEqual(urls, ["https://media.example.test/verification/u/old.png"]);
  });
});
