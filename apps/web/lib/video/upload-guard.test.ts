import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { MAX_PROXY_BODY_BYTES, declaredBodyTooLarge, isShowcaseVideoKey, isShowcaseVideoKeyForMedia, proxyUploadKind, readBoundedBody } from "./upload-guard.ts";

const FIFTY_MB = 50 * 1024 * 1024;
const CHUNK = 64 * 1024;

/** A source stream that counts how many bytes the consumer actually pulls. */
function countingBody(totalBytes: number, chunkSize = CHUNK) {
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - produced);
      produced += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return { stream, produced: () => produced };
}

test("declaredBodyTooLarge rejects an already-oversized body without reading it", () => {
  assert.equal(declaredBodyTooLarge(String(FIFTY_MB)), true);
  assert.equal(declaredBodyTooLarge(String(MAX_PROXY_BODY_BYTES)), false);
  assert.equal(declaredBodyTooLarge(String(8 * 1024 * 1024)), false);
  // Absent / malformed headers are not rejected here — the bounded read is the
  // real enforcement, so a chunked body is still safe.
  assert.equal(declaredBodyTooLarge(null), false);
  assert.equal(declaredBodyTooLarge("not-a-number"), false);
});

test("AFTER: a 50 MB proxy body is cancelled at the cap, never buffered whole", async () => {
  const { stream, produced } = countingBody(FIFTY_MB);
  const result = await readBoundedBody(stream, MAX_PROXY_BODY_BYTES);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "too_large");
  // The source was stopped shortly after the cap — nowhere near 50 MB.
  assert.ok(
    produced() <= MAX_PROXY_BODY_BYTES + CHUNK,
    `pulled ${produced()} bytes, expected ≤ ${MAX_PROXY_BODY_BYTES + CHUNK}`,
  );
  assert.ok(produced() < FIFTY_MB / 2, `pulled ${produced()} bytes, expected far below 50 MB`);
});

test("readBoundedBody returns the exact bytes for a body within the cap", async () => {
  const payload = new Uint8Array(CHUNK + 7).fill(3);
  const result = await readBoundedBody(new Response(payload).body);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.bytes.byteLength, payload.byteLength);
    assert.deepEqual(result.bytes, payload);
  }
});

test("readBoundedBody reports an empty body", async () => {
  const result = await readBoundedBody(new Response(new Uint8Array(0)).body);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "empty");
  assert.equal((await readBoundedBody(null)).ok, false);
});

test("bounded bytes still parse back into the uploaded form file", async () => {
  // Mirrors the route: bound the raw body, then rebuild a Response and parse
  // multipart from the held bytes.
  const original = new File([new Uint8Array(64).fill(9)], "shot.png", { type: "image/png" });
  const form = new FormData();
  form.append("file", original);
  const raw = new Request("https://app.test/upload", { method: "POST", body: form });
  const contentType = raw.headers.get("content-type")!;

  const bounded = await readBoundedBody(raw.body);
  assert.equal(bounded.ok, true);
  if (!bounded.ok) return;

  const reparsed = await new Response(bounded.bytes, {
    headers: { "content-type": contentType },
  }).formData();
  const file = reparsed.get("file");
  assert.ok(file instanceof File);
  if (file instanceof File) {
    assert.equal(file.type, "image/png");
    assert.equal(file.name, "shot.png");
    assert.equal(file.size, original.size);
  }
});

test("the multipart proxy path refuses videos and only serves images", () => {
  assert.equal(proxyUploadKind("video/mp4"), "video");
  assert.equal(proxyUploadKind("video/webm"), "video");
  assert.equal(proxyUploadKind("video/quicktime"), "video");
  assert.equal(proxyUploadKind("image/jpeg"), "image");
  assert.equal(proxyUploadKind("image/gif"), "image");
  assert.equal(proxyUploadKind("application/pdf"), "unsupported");
  assert.equal(proxyUploadKind("application/octet-stream"), "unsupported");
});

test("object keys are bound to the media id they were issued for", () => {
  const mediaId = "3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
  const key = `media/videos/processed/${mediaId}.mp4`;

  assert.equal(isShowcaseVideoKey(key), true);
  assert.equal(isShowcaseVideoKeyForMedia(key, mediaId), true);
  // Uppercase media id still matches its lowercase ticket key.
  assert.equal(isShowcaseVideoKeyForMedia(key, mediaId.toUpperCase()), true);

  // A different upload's key must not match this media id.
  const other = "11111111-2222-4333-8444-555555555555";
  assert.equal(isShowcaseVideoKeyForMedia(key, other), false);
  assert.equal(isShowcaseVideoKey(`media/videos/processed/${other}.mp4`), true);

  // Arbitrary / traversing / non-issued keys are rejected outright.
  assert.equal(isShowcaseVideoKey("showcase/abc/user/x.png"), false);
  assert.equal(isShowcaseVideoKey("media/videos/processed/../../secret.mp4"), false);
  assert.equal(isShowcaseVideoKey("media/videos/processed/not-a-uuid.mp4"), false);
  assert.equal(isShowcaseVideoKey("media/videos/processed/" + mediaId + ".exe"), false);
});
