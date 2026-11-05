import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { findPexelsImage, isPexelsConfigured } from "./pexels-image";

const originalFetch = globalThis.fetch;
const originalKey = process.env.PEXELS_API_KEY;

const PHOTO = (src: string, alt: string) => ({ alt, src: { large2x: src } });

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jpeg(): Response {
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
    status: 200,
    headers: { "Content-Type": "image/jpeg" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.PEXELS_API_KEY;
  else process.env.PEXELS_API_KEY = originalKey;
});

test("isPexelsConfigured requires a non-blank key", () => {
  delete process.env.PEXELS_API_KEY;
  assert.equal(isPexelsConfigured(), false);
  process.env.PEXELS_API_KEY = "   ";
  assert.equal(isPexelsConfigured(), false);
  process.env.PEXELS_API_KEY = " key ";
  assert.equal(isPexelsConfigured(), true);
});

test("returns null without calling Pexels when the key is missing", async () => {
  delete process.env.PEXELS_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return json({ photos: [] });
  }) as typeof fetch;

  assert.equal(await findPexelsImage("Mumbai"), null);
  assert.equal(calls, 0);
});

test("searches with the key and prefers the skyline over a travel portrait", async () => {
  process.env.PEXELS_API_KEY = "test-key";
  const apiCalls: Array<{ url: string; headers: Headers }> = [];
  const downloads: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.pexels.com/")) {
      apiCalls.push({ url, headers: new Headers(init?.headers) });
      return json({
        photos: [
          PHOTO("https://images.pexels.com/portrait.jpeg", "Woman walking through Mumbai"),
          PHOTO("https://images.pexels.com/skyline.jpeg", "Mumbai skyline at sunset"),
        ],
      });
    }
    downloads.push(url);
    return jpeg();
  }) as typeof fetch;

  const image = await findPexelsImage("Mumbai");

  assert.equal(image?.source, "https://images.pexels.com/skyline.jpeg");
  assert.equal(image?.contentType, "image/jpeg");
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].headers.get("authorization"), "test-key");
  const search = new URL(apiCalls[0].url);
  assert.equal(search.searchParams.get("query"), "Mumbai");
  assert.equal(search.searchParams.get("orientation"), "landscape");
  assert.deepEqual(downloads, ["https://images.pexels.com/skyline.jpeg"]);
});

test("falls through to the next photo when a download is not an image", async () => {
  process.env.PEXELS_API_KEY = "test-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://api.pexels.com/")) {
      return json({
        photos: [
          PHOTO("https://images.pexels.com/broken.jpeg", "Mumbai skyline"),
          PHOTO("https://images.pexels.com/ok.jpeg", "Mumbai street"),
        ],
      });
    }
    return url.endsWith("broken.jpeg")
      ? new Response("<html>blocked</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      : jpeg();
  }) as typeof fetch;

  const image = await findPexelsImage("Mumbai");
  assert.equal(image?.source, "https://images.pexels.com/ok.jpeg");
});

test("returns null when Pexels rejects the request", async () => {
  process.env.PEXELS_API_KEY = "test-key";
  globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch;
  assert.equal(await findPexelsImage("Mumbai"), null);
});
