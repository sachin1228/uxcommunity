import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { runMembershipRevocationRetries } from "../src/membership-revocations";

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_ENV: "production",
    API_URL: "https://app.example.com",
    API_SECRET: "internal-secret",
    ...overrides,
  } as Env;
}

describe("runMembershipRevocationRetries", () => {
  it("drains the queue through the internal endpoint with the API secret", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await runMembershipRevocationRetries(env(), (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true, scanned: 2, completed: 1, failed: 1 }), {
        status: 200,
      });
    }) as typeof fetch);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://app.example.com/api/internal/membership-revocations/process",
    );
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer internal-secret",
    );
    expect(result.summary).toMatchObject({ scanned: 2, completed: 1, failed: 1 });
  });

  it("returns not-ok on a non-2xx response so the next tick retries", async () => {
    const result = await runMembershipRevocationRetries(
      env(),
      (async () => new Response("unavailable", { status: 503 })) as typeof fetch,
    );
    expect(result).toEqual({ ok: false, status: 503 });
  });

  it("absorbs a network failure instead of crashing the cron", async () => {
    const result = await runMembershipRevocationRetries(
      env(),
      (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    );
    expect(result.ok).toBe(false);
  });

  it("does not call the endpoint without the internal configuration", async () => {
    let called = false;
    const result = await runMembershipRevocationRetries(
      env({ API_SECRET: "" }),
      (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
