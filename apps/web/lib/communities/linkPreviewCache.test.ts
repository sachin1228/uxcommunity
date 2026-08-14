import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  LINK_PREVIEW_FAILURE_RETRY_MS,
  LINK_PREVIEW_STALE_MS,
  clearLinkPreviewCache,
  fetchLinkPreview,
  getCachedLinkPreview,
  hasFreshLinkPreview,
  isLinkPreviewLoading,
  normalizePreviewUrl,
} from "./linkPreviewCache";

const originalFetch = globalThis.fetch;
const originalNow = Date.now;

const PREVIEW = (url: string, title: string) =>
  new Response(
    JSON.stringify({
      url,
      title,
      description: null,
      image: null,
      siteName: "example.com",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

afterEach(() => {
  clearLinkPreviewCache();
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
});

test("normalizes equivalent URLs to one cache key", () => {
  assert.equal(
    normalizePreviewUrl("https://Example.com/Path/#section"),
    "https://example.com/Path",
  );
  assert.equal(
    normalizePreviewUrl("https://example.com/path/"),
    "https://example.com/path",
  );
  assert.equal(
    normalizePreviewUrl("https://example.com/a?b=2&a=1#frag"),
    "https://example.com/a?a=1&b=2",
  );
  assert.equal(normalizePreviewUrl("https://example.com:443/"), "https://example.com/");
  assert.notEqual(
    normalizePreviewUrl("https://example.com/a"),
    normalizePreviewUrl("https://example.com/a?x=1"),
  );
});

test("same URL requested twice concurrently → one fetch, both share the result", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return PREVIEW("https://figma.com/file/abc", "Figma");
  }) as typeof fetch;

  const url = "https://figma.com/file/abc";
  const firstPromise = fetchLinkPreview(url);
  const secondPromise = fetchLinkPreview(url);

  // While in flight, the loading flag is visible to other components.
  assert.equal(isLinkPreviewLoading(url), true);

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(calls, 1);
  assert.equal(first.source, "network");
  assert.equal(second.source, "in-flight");
  assert.equal(second.fromExistingRequest, true);
  // Both components received the same promise → identical data.
  assert.deepEqual(first.data, second.data);
  assert.equal(isLinkPreviewLoading(url), false);
});

test("different URLs → separate fetches", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    const raw = String(input);
    requested.push(raw);
    return PREVIEW(raw, "Preview");
  }) as typeof fetch;

  await Promise.all([
    fetchLinkPreview("https://figma.com/file/abc"),
    fetchLinkPreview("https://dribbble.com/shots/xyz"),
  ]);

  assert.equal(requested.length, 2);
  assert.ok(requested[0]?.includes("figma.com"));
  assert.ok(requested[1]?.includes("dribbble.com"));
});

test("fresh cache returns without a network request", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return PREVIEW("https://example.com", "Example");
  }) as typeof fetch;

  const url = "https://example.com";
  assert.equal(getCachedLinkPreview(url), undefined);

  const first = await fetchLinkPreview(url);
  assert.equal(first.source, "network");
  assert.equal(first.data?.title, "Example");

  const second = await fetchLinkPreview(url);
  assert.equal(second.source, "cache");
  assert.equal(second.data?.title, "Example");
  assert.equal(calls, 1);
  assert.equal(hasFreshLinkPreview(url), true);
  assert.equal(getCachedLinkPreview(url)?.title, "Example");
});

test("stale cache refetches over the network", async () => {
  let now = 1_000;
  Date.now = () => now;

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return PREVIEW("https://example.com", `Title ${calls}`);
  }) as typeof fetch;

  const url = "https://example.com";
  try {
    const first = await fetchLinkPreview(url);
    assert.equal(first.data?.title, "Title 1");
    assert.equal(calls, 1);

    // Beyond the 10-minute freshness window → background refetch.
    now += LINK_PREVIEW_STALE_MS + 1;
    const second = await fetchLinkPreview(url);
    assert.equal(second.data?.title, "Title 2");
    assert.equal(second.source, "network");
    assert.equal(calls, 2);
    assert.equal(hasFreshLinkPreview(url), true);
  } finally {
    Date.now = originalNow;
  }
});

test("failed requests are temporarily cached and retried after the window", async () => {
  let now = 1_000;
  Date.now = () => now;

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "Upstream error" }), { status: 422 });
  }) as typeof fetch;

  const url = "https://broken.example.com";
  try {
    const failed = await fetchLinkPreview(url);
    assert.equal(failed.data, null);
    assert.equal(failed.source, "network");
    assert.equal(calls, 1);
    assert.equal(getCachedLinkPreview(url), null);

    // Inside the 60-second failure window → no network retry.
    now += LINK_PREVIEW_FAILURE_RETRY_MS - 1;
    const suppressed = await fetchLinkPreview(url);
    assert.equal(suppressed.data, null);
    assert.equal(suppressed.source, "error");
    assert.equal(suppressed.fromExistingRequest, false);
    assert.equal(calls, 1);

    // After the window → the URL is retried.
    now += 2;
    const retried = await fetchLinkPreview(url);
    assert.equal(retried.data, null);
    assert.equal(calls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("normalized-equivalent URLs share one request and one cache entry", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return PREVIEW("https://example.com/path", "Example");
  }) as typeof fetch;

  await Promise.all([
    fetchLinkPreview("https://Example.com/path/#section"),
    fetchLinkPreview("https://example.com/path/"),
    fetchLinkPreview("https://example.com/path#top"),
  ]);

  assert.equal(calls, 1);
  assert.equal(hasFreshLinkPreview("https://example.com/path/"), true);
  assert.equal(hasFreshLinkPreview("HTTPS://example.com/path"), true);
});

test("concurrent stale callers join one refetch instead of firing duplicates", async () => {
  let now = 1_000;
  Date.now = () => now;

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return PREVIEW("https://example.com", "Fresh");
  }) as typeof fetch;

  const url = "https://example.com";
  try {
    await fetchLinkPreview(url);
    now += LINK_PREVIEW_STALE_MS + 1;

    const results = await Promise.all([
      fetchLinkPreview(url),
      fetchLinkPreview(url),
    ]);

    assert.equal(calls, 2); // initial + one shared refetch
    assert.equal(results[0].source, "network");
    assert.equal(results[1].source, "in-flight");
    assert.deepEqual(results[0].data, results[1].data);
    assert.equal(results[0].data?.title, "Fresh");
  } finally {
    Date.now = originalNow;
  }
});
