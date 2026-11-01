import { afterEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  secretMatches,
  validateSessionWithApi,
} from "../src/session-validation";

const env = {
  APP_ENV: "production",
  API_URL: "https://app.example.test",
  API_SECRET: "api-secret",
  SESSION_SECRET: "session-secret",
  REALTIME_PUBLISH_SECRET: "publish-secret",
} as unknown as Env;

const claims = { userId: "user-1", sid: "session-1", sv: 3 };

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = implementation as typeof fetch;
}

describe("realtime session validation", () => {
  it("accepts a live registry response for the same user/version", async () => {
    let seenUrl = "";
    let seenBody: unknown;
    let seenAuth = "";
    mockFetch(async (input, init) => {
      seenUrl = String(input);
      seenBody = JSON.parse(String(init?.body));
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ ok: true, userId: "user-1", sessionVersion: 3 });
    });

    expect(await validateSessionWithApi(env, claims)).toBe(true);
    expect(seenUrl).toBe("https://app.example.test/api/internal/session/validate");
    expect(seenBody).toEqual(claims);
    expect(seenAuth).toBe("Bearer api-secret");
  });

  it("rejects a response for a different user", async () => {
    mockFetch(async () =>
      Response.json({ ok: true, userId: "user-2", sessionVersion: 3 }),
    );
    expect(await validateSessionWithApi(env, claims)).toBe(false);
  });

  it("rejects a response with a different session version", async () => {
    mockFetch(async () =>
      Response.json({ ok: true, userId: "user-1", sessionVersion: 4 }),
    );
    expect(await validateSessionWithApi(env, claims)).toBe(false);
  });

  it("rejects a 401 from the registry validation", async () => {
    mockFetch(async () => new Response(JSON.stringify({ ok: false }), { status: 401 }));
    expect(await validateSessionWithApi(env, claims)).toBe(false);
  });

  it("fails closed on a malformed body", async () => {
    mockFetch(async () => new Response("not json", { status: 200 }));
    expect(await validateSessionWithApi(env, claims)).toBe(false);
  });

  it("fails closed when API_URL is missing", async () => {
    expect(
      await validateSessionWithApi({ ...env, API_URL: "" } as Env, claims),
    ).toBe(false);
  });

  it("fails closed when API_SECRET is missing", async () => {
    expect(
      await validateSessionWithApi({ ...env, API_SECRET: "" } as Env, claims),
    ).toBe(false);
  });

  it("fails closed on a network error", async () => {
    mockFetch(async () => {
      throw new Error("connection reset");
    });
    expect(await validateSessionWithApi(env, claims)).toBe(false);
  });
});

describe("internal secret comparison", () => {
  it("only accepts the exact secret", () => {
    expect(secretMatches("publish-secret", "publish-secret")).toBe(true);
    expect(secretMatches("publish-secret", "publish-secret2")).toBe(false);
    expect(secretMatches("", "publish-secret")).toBe(false);
    expect(secretMatches(null, "publish-secret")).toBe(false);
    expect(secretMatches("publish-secret", undefined)).toBe(false);
  });
});
