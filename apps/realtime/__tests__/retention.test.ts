import { afterEach, describe, expect, it, vi } from "vitest";
import { runRetentionSweep } from "../src/retention";
import type { Env } from "../src/env";

const ENV = { API_URL: "https://app.example", API_SECRET: "test-secret" } as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runRetentionSweep", () => {
  it("POSTs the internal retention endpoint with the API secret", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        summary: {
          deletedMessages: 12,
          deletedImages: 3,
          communities: 2,
          batches: 1,
          complete: true,
          pendingMessages: null,
          durationMs: 800,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runRetentionSweep(ENV);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.example/api/internal/community-message-retention");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-secret");
  });

  it("does not call the web app when its configuration is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await runRetentionSweep({} as unknown as Env);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a network failure instead of throwing into the scheduler", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection reset");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runRetentionSweep(ENV)).resolves.toBeUndefined();
  });

  it("does not throw when the endpoint answers with an error status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runRetentionSweep(ENV)).resolves.toBeUndefined();
  });
});
