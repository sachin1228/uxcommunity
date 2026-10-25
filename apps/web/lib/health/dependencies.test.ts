import test from "node:test";
import assert from "node:assert/strict";

import {
  CACHE_BUCKET_BINDING,
  CACHE_MAX_PAGES,
  CACHE_WARN_OBJECTS,
  CacheBindingMissingError,
  checkDatabase,
  checkDependencies,
  checkGiphy,
  checkR2Cache,
  checkR2Media,
  checkRealtimeWorker,
  checkResend,
  checkUpstash,
  HEALTHCHECK_PREFIX,
  scanCacheBucket,
  type CacheBucketPage,
} from "./dependencies";

/** The 401 that took every upload route down on 2026-10-09. */
function r2Unauthorized() {
  const error = new Error("Unauthorized");
  error.name = "Unauthorized";
  (error as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 401 };
  return error;
}

/** A fetch stub that records what was sent and answers with one status. */
function stubFetch(status: number) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(status === 200 ? "ok" : "nope", { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/**
 * One listing page of incremental-cache entries.
 *
 * Entries are `[key, size, written]` so a test can put different builds in
 * different pages and still control which one looks newest — the property the
 * scan sorts on.
 */
function cachePage(
  entries: Array<[key: string, size: number, uploaded?: string]>,
  options: { cursor?: string; truncated?: boolean } = {},
): CacheBucketPage {
  return {
    objects: entries.map(([key, size, uploaded]) => ({
      key,
      size,
      uploaded: Date.parse(uploaded ?? "2026-10-01T00:00:00.000Z"),
    })),
    truncated: options.truncated ?? false,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  };
}

const withPublicBase = async (fn: () => Promise<void>) => {
  const previous = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = "https://media.example.in";
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.R2_PUBLIC_URL;
    else process.env.R2_PUBLIC_URL = previous;
  }
};

test("a readable media bucket reports ok and names the public base", async () => {
  await withPublicBase(async () => {
    const prefixes: string[] = [];
    const check = await checkR2Media(async (prefix) => {
      prefixes.push(prefix);
      return { objects: [] };
    });

    assert.equal(check.status, "ok");
    assert.equal(check.id, "r2");
    assert.match(check.detail, /https:\/\/media\.example\.in/);
    assert.deepEqual(prefixes, [HEALTHCHECK_PREFIX], "the probe must stay inside its own prefix");
    assert.ok(typeof check.latencyMs === "number");
  });
});

test("a rejected R2 credential is down, with the rotation hint attached", async () => {
  await withPublicBase(async () => {
    const check = await checkR2Media(async () => {
      throw r2Unauthorized();
    });

    assert.equal(check.status, "down");
    assert.match(check.detail, /rejected the media credential/);
    assert.match(check.detail, /HTTP 401/);
    assert.match(check.hint ?? "", /R2_ACCESS_KEY_ID/);
    assert.match(check.hint ?? "", /verify:r2/);
  });
});

test("an ordinary R2 failure degrades without claiming the credential is dead", async () => {
  await withPublicBase(async () => {
    const check = await checkR2Media(async () => {
      const error = new Error("NoSuchBucket");
      error.name = "NoSuchBucket";
      (error as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 404 };
      throw error;
    });

    assert.equal(check.status, "degraded");
    assert.equal(check.hint?.includes("R2_ACCESS_KEY_ID"), false);
  });
});

test("a missing public URL is down before any request is made", async () => {
  const previous = process.env.R2_PUBLIC_URL;
  delete process.env.R2_PUBLIC_URL;
  try {
    let listed = false;
    const check = await checkR2Media(async () => {
      listed = true;
      return { objects: [] };
    });

    assert.equal(check.status, "down");
    assert.match(check.detail, /R2_PUBLIC_URL/);
    assert.equal(listed, false, "no bucket call is worth making without a public URL");
  } finally {
    if (previous !== undefined) process.env.R2_PUBLIC_URL = previous;
  }
});

test("a scan adds objects, bytes and build prefixes up across pages, newest build first", async () => {
  const cursors: Array<string | undefined> = [];
  const usage = await scanCacheBucket(async (cursor) => {
    cursors.push(cursor);
    if (!cursor) {
      return cachePage(
        [
          ["incremental-cache/build-old/a.cache", 100, "2026-09-01T00:00:00.000Z"],
          ["incremental-cache/build-old/b.cache", 100, "2026-09-02T00:00:00.000Z"],
          ["loose-key-without-a-build", 25, "2026-08-01T00:00:00.000Z"],
        ],
        { truncated: true, cursor: "page-2" },
      );
    }
    return cachePage([["incremental-cache/build-new/c.cache", 50, "2026-10-10T00:00:00.000Z"]]);
  });

  assert.deepEqual(cursors, [undefined, "page-2"], "page two must start from page one's cursor");
  assert.equal(usage.objectCount, 4);
  assert.equal(usage.totalBytes, 275);
  assert.equal(usage.truncated, false);
  assert.deepEqual(
    usage.builds.map((build) => [build.buildId, build.objects, build.bytes]),
    [
      ["build-new", 1, 50],
      ["build-old", 2, 200],
      ["(unrecognised keys)", 1, 25],
    ],
    "newest build first, and a key that names no build is still counted",
  );
});

test("a bucket that never ends stops at the page cap and says its numbers are lower bounds", async () => {
  let calls = 0;
  const usage = await scanCacheBucket(async () => {
    calls += 1;
    return cachePage([[`incremental-cache/build-${calls}/${calls}.cache`, 10]], {
      truncated: true,
      cursor: `cursor-${calls}`,
    });
  });

  assert.equal(calls, CACHE_MAX_PAGES, "one check must never walk a runaway bucket");
  assert.equal(usage.objectCount, CACHE_MAX_PAGES);
  assert.equal(usage.truncated, true);
});

test("a truncated page with no cursor ends the scan instead of repeating it", async () => {
  let calls = 0;
  const usage = await scanCacheBucket(async () => {
    calls += 1;
    return cachePage([["incremental-cache/build/a.cache", 1]], { truncated: true });
  });

  assert.equal(calls, 1, "without a cursor the next listing would be the same page again");
  assert.equal(usage.truncated, false, "nothing was left unread");
});

test("the cache bucket check reports the numbers and stays healthy while they are modest", async () => {
  const check = await checkR2Cache(async () => ({
    objectCount: 9_920,
    totalBytes: 239.86 * 1024 ** 2,
    builds: [
      { buildId: "build-new", objects: 12, bytes: 300_000, lastUploaded: Date.parse("2026-10-12") },
      { buildId: "build-old", objects: 9_908, bytes: 251_202_428, lastUploaded: Date.parse("2026-10-01") },
    ],
    truncated: false,
  }));

  assert.equal(check.status, "ok");
  assert.equal(check.id, "r2-cache");
  assert.equal(check.severity, "supporting");
  assert.equal(check.alerts, false, "a grown bucket is a cleanup job, not an outage");
  assert.match(check.detail, /9,920 objects/);
  assert.match(check.detail, /239\.86 MB/);
  assert.match(check.detail, /2 build prefixes/);
  assert.match(check.detail, /everything older holds 239\.57 MB/);
  assert.equal(check.hint, undefined, "nothing to fix yet");
});

test("a bucket past the warning line degrades, naming what grows it", async () => {
  const check = await checkR2Cache(async () => ({
    objectCount: CACHE_WARN_OBJECTS + 1,
    totalBytes: 1024 ** 3,
    builds: [{ buildId: "build-new", objects: 12, bytes: 1000, lastUploaded: Date.parse("2026-10-12") }],
    truncated: true,
  }));

  assert.equal(check.status, "degraded");
  assert.match(check.detail, /lower bounds/);
  assert.match(check.hint ?? "", /25,000/);
  assert.match(check.hint ?? "", /deploy/);
});

test("no cache binding is down, and points at the binding rather than the media credential", async () => {
  const check = await checkR2Cache(async () => {
    throw new CacheBindingMissingError();
  });

  assert.equal(check.status, "down");
  assert.match(check.detail, /per-isolate memory/);
  assert.match(check.hint ?? "", new RegExp(CACHE_BUCKET_BINDING));
  assert.match(check.hint ?? "", /apps\/web\/wrangler\.toml/);
  assert.equal(check.hint?.includes("R2_ACCESS_KEY_ID"), false);
});

test("a process that is not a Worker reports nothing to read, not a fault", async () => {
  // No injected scanner: this exercises the real path. A Node test process has
  // no Cloudflare context — the same shape as a local `next dev` server, which
  // is where the card was first read — and neither is a broken deploy, so
  // neither may put a red card on the page.
  const check = await checkR2Cache();

  assert.equal(check.status, "ok");
  assert.match(check.detail, /Not running on Cloudflare/);
  assert.equal(check.hint, undefined, "nothing is broken, so there is nothing to fix");
  assert.equal(check.severity, "supporting");
});

test("a bucket that answers an error degrades without blaming the binding", async () => {
  const check = await checkR2Cache(async () => {
    const error = new Error("NoSuchBucket");
    error.name = "NoSuchBucket";
    throw error;
  });

  assert.equal(check.status, "degraded");
  assert.match(check.detail, /NoSuchBucket/);
  assert.equal(check.hint?.includes(CACHE_BUCKET_BINDING), false);
});

test("the database check reports the query answer, and the error when it fails", async () => {
  const ok = await checkDatabase(async () => {});
  assert.equal(ok.status, "ok");
  assert.equal(ok.id, "supabase");

  const failing = await checkDatabase(async () => {
    throw new Error("relation \"users\" does not exist");
  });
  assert.equal(failing.status, "down");
  assert.match(failing.detail, /users/);
});

test("a healthy realtime worker is ok and nothing is published", async () => {
  const { fetchImpl, calls } = stubFetch(400); // the worker's answer to an empty payload
  const check = await checkRealtimeWorker({
    url: "https://rt.example.in",
    secret: "publish-secret-value",
    fetchImpl,
  });

  assert.equal(check.status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://rt.example.in/publish");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body, { events: [] }, "the probe must never carry an event to deliver");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["x-realtime-publish-secret"], "publish-secret-value");
});

test("a rejected publish secret is down, naming the secret both workers share", async () => {
  const { fetchImpl } = stubFetch(403);
  const check = await checkRealtimeWorker({
    url: "https://rt.example.in",
    secret: "stale-secret",
    fetchImpl,
  });

  assert.equal(check.status, "down");
  assert.match(check.detail, /403/);
  assert.match(check.hint ?? "", /REALTIME_PUBLISH_SECRET/);
});

test("a wrong realtime URL and a worker error are reported apart from a bad secret", async () => {
  const notFound = await checkRealtimeWorker({
    url: "https://rt.example.in",
    secret: "s",
    fetchImpl: stubFetch(404).fetchImpl,
  });
  assert.equal(notFound.status, "down");
  assert.match(notFound.detail, /404/);

  const serverError = await checkRealtimeWorker({
    url: "https://rt.example.in",
    secret: "s",
    fetchImpl: stubFetch(503).fetchImpl,
  });
  assert.equal(serverError.status, "degraded");
  assert.match(serverError.detail, /503/);
});

test("an unreachable worker and an unconfigured environment are both down", async () => {
  const unreachable = await checkRealtimeWorker({
    url: "https://rt.example.in",
    secret: "s",
    fetchImpl: (async () => {
      throw new Error("getaddrinfo ENOTFOUND rt.example.in");
    }) as unknown as typeof fetch,
  });
  assert.equal(unreachable.status, "down");
  assert.match(unreachable.detail, /ENOTFOUND/);

  const unconfigured = await checkRealtimeWorker({ url: "", secret: "" });
  assert.equal(unconfigured.status, "down");
  assert.match(unconfigured.hint ?? "", /REALTIME_URL/);
});

test("Upstash reports a rejected token, and says rate limiting is off when unset", async () => {
  const rejected = await checkUpstash({
    url: "https://up.example.in",
    token: "t",
    fetchImpl: stubFetch(401).fetchImpl,
  });
  assert.equal(rejected.status, "down");
  assert.match(rejected.hint ?? "", /UPSTASH_REDIS_REST_TOKEN/);
  assert.match(rejected.detail, /401/);

  const answered = await checkUpstash({
    url: "https://up.example.in/",
    token: "t",
    fetchImpl: (async () => new Response("{\"result\":\"PONG\"}", { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal(answered.status, "ok");
  assert.match(answered.detail, /PONG/);

  const unset = await checkUpstash({ url: "", token: "" });
  assert.equal(unset.status, "down");
  assert.match(unset.detail, /rate limiting is off/);
});

test("Resend is critical: a rejected key silently kills password resets", async () => {
  const { fetchImpl, calls } = stubFetch(401);
  const rejected = await checkResend({ apiKey: "key", fetchImpl });

  assert.equal(calls[0].url, "https://api.resend.com/domains");
  assert.equal(rejected.status, "down");
  assert.equal(rejected.severity, "critical");
  assert.equal(rejected.alerts, true);
  assert.match(rejected.hint ?? "", /Password resets and welcome emails fail silently/);

  const ok = await checkResend({ apiKey: "key", fetchImpl: stubFetch(200).fetchImpl });
  assert.equal(ok.status, "ok");

  const unset = await checkResend({ apiKey: "" });
  assert.equal(unset.status, "down");
});

test("GIPHY is supporting only: its key can fail without paging anyone", async () => {
  const rejected = await checkGiphy({ apiKey: "key", fetchImpl: stubFetch(403).fetchImpl });
  assert.equal(rejected.status, "down");
  assert.equal(rejected.severity, "supporting");
  assert.equal(rejected.alerts, false);

  const ok = await checkGiphy({ apiKey: "key", fetchImpl: stubFetch(200).fetchImpl });
  assert.equal(ok.status, "ok");
});

/** Every probe stubbed healthy, so the report can be exercised offline. */
const allHealthy = () => ({
  r2: async () => ({ objects: [] }),
  "r2-cache": async () => ({
    objectCount: 4,
    totalBytes: 4096,
    builds: [{ buildId: "build", objects: 4, bytes: 4096, lastUploaded: 0 }],
    truncated: false,
  }),
  database: async () => {},
  realtime: { url: "https://rt.example.in", secret: "s", fetchImpl: stubFetch(400).fetchImpl },
  upstash: { url: "https://up.example.in", token: "t", fetchImpl: stubFetch(200).fetchImpl },
  resend: { apiKey: "k", fetchImpl: stubFetch(200).fetchImpl },
  giphy: { apiKey: "g", fetchImpl: stubFetch(200).fetchImpl },
});

test("the report separates what must page an admin from what must not", async () => {
  await withPublicBase(async () => {
    const healthy = await checkDependencies(allHealthy());
    assert.equal(healthy.healthy, true);
    assert.equal(healthy.allOk, true);
    assert.deepEqual(healthy.alerts, []);
    assert.deepEqual(
      healthy.checks.map((entry) => entry.id),
      ["r2", "r2-cache", "supabase", "realtime", "upstash", "resend", "giphy"],
    );
    assert.ok(Date.parse(healthy.checkedAt) > 0);

    // A broken critical service is unhealthy AND alertable. One bad dependency
    // must not hide the state of the others.
    const critical = await checkDependencies({
      ...allHealthy(),
      r2: async () => {
        throw r2Unauthorized();
      },
    });
    assert.equal(critical.healthy, false);
    assert.deepEqual(critical.alerts.map((entry) => entry.id), ["r2"]);
    assert.equal(critical.checks.filter((entry) => entry.status === "ok").length, 6);

    // A broken supporting service is visible but stays silent: the app still
    // serves, and an admin should not be woken for GIF search.
    const supporting = await checkDependencies({
      ...allHealthy(),
      giphy: { apiKey: "g", fetchImpl: stubFetch(500).fetchImpl },
    });
    assert.equal(supporting.healthy, true, "GIPHY is not on the critical path");
    assert.equal(supporting.allOk, false);
    assert.deepEqual(supporting.alerts, []);
  });
});
