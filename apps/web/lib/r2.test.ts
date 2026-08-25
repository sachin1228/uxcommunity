import assert from "node:assert/strict";
import test from "node:test";
import {
  getR2Object,
  parseR2Key,
  putR2Object,
  r2PublicUrl,
  requireR2Bucket,
  type NativeR2Bucket,
  type NativeR2ObjectBody,
} from "./r2";

class MockR2Bucket implements NativeR2Bucket {
  objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<void> {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.objects.set(key, {
      bytes: new Uint8Array(bytes),
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async get(key: string): Promise<NativeR2ObjectBody | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    const bytes = object.bytes;
    return {
      async arrayBuffer() {
        return bytes.slice().buffer;
      },
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

function withPublicUrl(value: string, callback: () => void): void {
  const previous = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = value;
  try {
    callback();
  } finally {
    if (previous === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = previous;
  }
}

test("public URL helpers normalize trailing slashes and preserve object keys", () => {
  withPublicUrl("https://images.example.com///", () => {
    const url = r2PublicUrl("avatars/user/image.webp");
    assert.equal(url, "https://images.example.com/avatars/user/image.webp");
    assert.equal(parseR2Key(url), "avatars/user/image.webp");
    assert.equal(parseR2Key("https://elsewhere.example/image.webp"), null);
  });
});

test("native bucket put/get/delete preserves bytes and content type", async () => {
  const bucket = new MockR2Bucket();
  const input = Buffer.from([0, 1, 2, 254, 255]);

  await putR2Object(bucket, "chat/image.webp", input, "image/webp");
  assert.equal(bucket.objects.get("chat/image.webp")?.contentType, "image/webp");
  assert.deepEqual(await getR2Object(bucket, "chat/image.webp"), input);

  await bucket.delete("chat/image.webp");
  await assert.rejects(
    getR2Object(bucket, "chat/image.webp"),
    /Object not found for key: chat\/image\.webp/
  );
});

test("missing native binding fails clearly instead of selecting a fallback", () => {
  assert.throws(
    () => requireR2Bucket({}),
    /Missing R2_BUCKET Cloudflare binding/
  );
});
