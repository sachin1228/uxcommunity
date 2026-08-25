import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { detectImageMime, moderateImageBuffer } from "./image";

const originalFetch = globalThis.fetch;
const originalServiceUrl = process.env.MODERATION_IMAGE_SERVICE_URL;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalServiceUrl === undefined) delete process.env.MODERATION_IMAGE_SERVICE_URL;
  else process.env.MODERATION_IMAGE_SERVICE_URL = originalServiceUrl;
});

test("detects supported image signatures and rejects mismatches", () => {
  assert.equal(detectImageMime(png), "image/png");
  assert.equal(detectImageMime(Buffer.alloc(12)), null);
});

test("allows locally valid images when the optional service is unconfigured", async () => {
  delete process.env.MODERATION_IMAGE_SERVICE_URL;
  const result = await moderateImageBuffer(png, "image/png");
  assert.equal(result.decision.status, "approved");
  assert.equal(result.decision.allowed, true);
  assert.equal(result.decision.provider, "image-gateway-fallback");
});

test("allows locally valid images when the provider is unavailable", async () => {
  process.env.MODERATION_IMAGE_SERVICE_URL = "https://moderation.test";
  globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
  const unavailable = await moderateImageBuffer(png, "image/png");
  assert.equal(unavailable.decision.status, "approved");
  assert.equal(unavailable.decision.provider, "image-gateway-fallback");

  globalThis.fetch = (async () => { throw new Error("timeout"); }) as typeof fetch;
  const failed = await moderateImageBuffer(png, "image/png");
  assert.equal(failed.decision.status, "approved");
  assert.equal(failed.decision.provider, "image-gateway-fallback");
});

test("preserves explicit provider moderation decisions", async () => {
  process.env.MODERATION_IMAGE_SERVICE_URL = "https://moderation.test";
  for (const status of ["approved", "review", "rejected"] as const) {
    globalThis.fetch = (async () => Response.json({ status, allowed: status === "approved", reason: status })) as typeof fetch;
    const result = await moderateImageBuffer(png, "image/png");
    assert.equal(result.decision.status, status);
    assert.equal(result.decision.allowed, status === "approved");
  }
});

test("does not approve malformed provider approval payloads", async () => {
  process.env.MODERATION_IMAGE_SERVICE_URL = "https://moderation.test";
  globalThis.fetch = (async () => Response.json({ status: "approved", allowed: false })) as typeof fetch;
  const result = await moderateImageBuffer(png, "image/png");
  assert.equal(result.decision.status, "review");
  assert.equal(result.decision.allowed, false);
});

test("rejects a declared MIME that does not match the file signature", async () => {
  const result = await moderateImageBuffer(png, "image/jpeg");
  assert.equal(result.decision.status, "rejected");
  assert.equal(result.decision.allowed, false);
});
