import assert from "node:assert/strict";
import test from "node:test";
import { revokeRealtimeCommunityMembership } from "./revoke";

const envKeys = ["APP_ENV", "REALTIME_URL", "REALTIME_PUBLISH_SECRET"] as const;

function withEnv(
  values: Partial<Record<(typeof envKeys)[number], string | undefined>>,
  fn: () => Promise<void>,
) {
  const env = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(envKeys.map((key) => [key, env[key]]));
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return fn().finally(() => {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });
}

test("community membership revocation targets the realtime /revoke endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    await withEnv(
      {
        APP_ENV: "production",
        REALTIME_URL: "https://rt.example.com",
        REALTIME_PUBLISH_SECRET: "test-secret",
      },
      async () => {
        const ok = await revokeRealtimeCommunityMembership({
          userId: "user-1",
          communityId: "community-1",
        });
        assert.equal(ok, true);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://rt.example.com/revoke");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    (calls[0].init.headers as Record<string, string>).Authorization,
    "Bearer test-secret",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    userId: "user-1",
    communityId: "community-1",
  });
});

test("a transient 502 is retried once", async () => {
  let attempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response("bad gateway", { status: attempts === 1 ? 502 : 200 });
  }) as typeof fetch;

  try {
    await withEnv(
      {
        APP_ENV: "production",
        REALTIME_URL: "https://rt.example.com",
        REALTIME_PUBLISH_SECRET: "test-secret",
      },
      async () => {
        const ok = await revokeRealtimeCommunityMembership({
          userId: "user-2",
          communityId: "community-2",
        });
        assert.equal(ok, true);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(attempts, 2);
});

test("missing realtime configuration is not a hard failure", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      REALTIME_URL: undefined,
      REALTIME_PUBLISH_SECRET: undefined,
    },
    async () => {
      assert.equal(
        await revokeRealtimeCommunityMembership({
          userId: "user-3",
          communityId: "community-3",
        }),
        false,
      );
    },
  );
});
