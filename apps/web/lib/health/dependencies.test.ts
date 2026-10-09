import test from "node:test";
import assert from "node:assert/strict";

import {
  checkDatabase,
  checkDependencies,
  checkR2Media,
  checkRealtimeWorker,
  HEALTHCHECK_PREFIX,
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

test("the report is healthy only when every dependency is ok", async () => {
  await withPublicBase(async () => {
    const healthy = await checkDependencies({
      r2: async () => ({ objects: [] }),
      database: async () => {},
      realtime: { url: "https://rt.example.in", secret: "s", fetchImpl: stubFetch(400).fetchImpl },
    });
    assert.equal(healthy.healthy, true);
    assert.deepEqual(healthy.checks.map((entry) => entry.id), ["r2", "supabase", "realtime"]);
    assert.ok(Date.parse(healthy.checkedAt) > 0);

    const degraded = await checkDependencies({
      r2: async () => {
        throw r2Unauthorized();
      },
      database: async () => {},
      realtime: { url: "https://rt.example.in", secret: "s", fetchImpl: stubFetch(400).fetchImpl },
    });
    assert.equal(degraded.healthy, false);
    // One bad dependency must not hide the state of the others.
    assert.equal(degraded.checks.filter((entry) => entry.status === "ok").length, 2);
  });
});
