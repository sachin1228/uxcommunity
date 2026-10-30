import test from "node:test";
import assert from "node:assert/strict";

import {
  dmAssetPath,
  dmKeyFromImageUrl,
  dmKeyToAssetPath,
  dmPathToKey,
  isOwnVerificationKey,
  isPrivateObjectKey,
  legacyPrivateKeyFromUrl,
  privateDmKey,
  privateResumeKey,
  privateVerificationKey,
  savedResumePath,
  resumeApplicationPath,
  signPrivateGet,
} from "./r2-private";

function setEnv(values: Record<string, string>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const PRIVATE_ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_PUBLIC_URL: "https://media.example.test",
  R2_PRIVATE_BUCKET_NAME: "uxcommunity-private",
};

test("isPrivateObjectKey accepts only the three private namespaces", () => {
  assert.equal(isPrivateObjectKey("resumes/u/abc.pdf"), true);
  assert.equal(isPrivateObjectKey("verification/u/abc.webp"), true);
  assert.equal(isPrivateObjectKey("dm/c/abc.webp"), true);
  assert.equal(isPrivateObjectKey("avatars/u/abc.webp"), false);
  assert.equal(isPrivateObjectKey("https://media.example.test/resumes/u/a.pdf"), false);
  assert.equal(isPrivateObjectKey("/resumes/u/a.pdf"), false);
  assert.equal(isPrivateObjectKey("resumes/../secret.pdf"), false);
  assert.equal(isPrivateObjectKey(""), false);
  assert.equal(isPrivateObjectKey(null), false);
});

test("legacy public URLs map to the private key they should move to", () => {
  const restore = setEnv(PRIVATE_ENV);
  try {
    assert.equal(
      legacyPrivateKeyFromUrl("https://media.example.test/resumes/u/a.pdf"),
      "resumes/u/a.pdf",
    );
    assert.equal(
      legacyPrivateKeyFromUrl("https://media.example.test/avatars/u/a.webp"),
      null,
    );
    assert.equal(legacyPrivateKeyFromUrl("https://elsewhere.test/resumes/u/a.pdf"), null);
  } finally {
    restore();
  }
});

test("new object keys are random UUID paths, not timestamps", () => {
  const first = privateResumeKey("user-id", "pdf");
  const second = privateResumeKey("user-id", "pdf");
  assert.match(first, /^resumes\/user-id\/[0-9a-f-]{36}\.pdf$/);
  assert.notEqual(first, second);
  assert.match(privateVerificationKey("user-id", "webp"), /^verification\/user-id\/[0-9a-f-]{36}\.webp$/);
  assert.match(privateDmKey("conv-id", "png"), /^dm\/conv-id\/[0-9a-f-]{36}\.png$/);
});

test("verification keys are scoped to the member prefix", () => {
  assert.equal(isOwnVerificationKey("verification/me/abc.webp", "me"), true);
  assert.equal(isOwnVerificationKey("verification/someone-else/abc.webp", "me"), false);
  assert.equal(isOwnVerificationKey("verification/me/../abc.webp", "me"), false);
  assert.equal(isOwnVerificationKey("resumes/me/abc.webp", "me"), false);
});

test("DM keys round-trip through the authorization-gated path", () => {
  const restore = setEnv(PRIVATE_ENV);
  const conversation = "11111111-1111-4111-8111-111111111111";
  const key = `dm/${conversation}/abc.webp`;
  try {
  assert.equal(dmKeyToAssetPath(key), dmAssetPath(conversation, "abc.webp"));
  assert.equal(dmPathToKey(conversation, "abc.webp"), key);
  assert.equal(dmPathToKey(conversation, "../abc.webp"), null);
  assert.equal(dmPathToKey("not-a-uuid", "abc.webp"), null);

  assert.equal(dmKeyFromImageUrl(dmAssetPath(conversation, "abc.webp")), key);
  assert.equal(dmKeyFromImageUrl(`https://media.example.test/${key}`), key);
  assert.equal(dmKeyFromImageUrl("https://media.giphy.com/media/x/giphy.gif"), null);
  } finally {
    restore();
  }
});

test("proxy paths are stable and contain no signatures", () => {
  assert.equal(
    resumeApplicationPath("22222222-2222-4222-8222-222222222222"),
    "/api/private/resume/application/22222222-2222-4222-8222-222222222222",
  );
  assert.equal(
    savedResumePath("33333333-3333-4333-8333-333333333333"),
    "/api/private/resume/saved/33333333-3333-4333-8333-333333333333",
  );
});

test("signed GET URLs are short-lived and point at the private bucket", async () => {
  const restore = setEnv(PRIVATE_ENV);
  try {
    const url = await signPrivateGet("resumes/u/a.pdf", { expiresInSeconds: 60 });
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "uxcommunity-private.account.r2.cloudflarestorage.com");
    assert.match(parsed.pathname, /^\/resumes\/u\/a\.pdf$/);
    assert.equal(parsed.searchParams.get("X-Amz-Expires"), "60");
    assert.ok(parsed.searchParams.get("X-Amz-Signature"));
    assert.ok(!url.includes("secret"));
  } finally {
    restore();
  }
});

test("signing refuses flags longer than one hour and non-private keys", async () => {
  const restore = setEnv(PRIVATE_ENV);
  try {
    const url = await signPrivateGet("resumes/u/a.pdf", { expiresInSeconds: 86_400 });
    assert.equal(new URL(url).searchParams.get("X-Amz-Expires"), "3600");
    await assert.rejects(() => signPrivateGet("avatars/u/a.webp"));
  } finally {
    restore();
  }
});

test("private writes fail closed when the private bucket is not configured", async () => {
  const restore = setEnv(PRIVATE_ENV);
  delete process.env.R2_PRIVATE_BUCKET_NAME;
  try {
    await assert.rejects(
      () => signPrivateGet("resumes/u/a.pdf"),
      /Private storage is not configured/,
    );
  } finally {
    restore();
  }
});
