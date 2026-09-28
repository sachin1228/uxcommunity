/**
 * Unit tests for the fan-out retry policy (production-readiness audit, M-1).
 *
 * These drive `retryWithBackoff` with an injected, deterministic clock so the
 * assertions are about policy (attempts, retryable vs permanent, backoff growth
 * and jitter), not about wall-clock timing.
 */

import { describe, expect, it, vi } from "vitest";
import { backoffDelay, isRetryableStatus, retryWithBackoff } from "../src/retry";

const POLICY = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, jitter: 0.25 };

/** A sleep + random pair that records delays without waiting. */
function fakeDeps(random = () => 0.5) {
  const sleeps: number[] = [];
  const retries: Array<{ attempt: number; delayMs: number }> = [];
  return {
    sleeps,
    retries,
    deps: {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      random,
      onRetry: (info: { attempt: number; delayMs: number }) => retries.push(info),
    },
  };
}

describe("retryWithBackoff", () => {
  it("returns the first successful result without retrying", async () => {
    const operation = vi.fn(async () => "ok");
    const { sleeps, deps } = fakeDeps();

    const result = await retryWithBackoff(operation, POLICY, () => false, deps);

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("succeeds after a transient failure retries", async () => {
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("network reset");
      return "recovered";
    });
    const { sleeps, retries, deps } = fakeDeps();

    const result = await retryWithBackoff(operation, POLICY, ({ error }) => !!error, deps);

    expect(result).toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
    expect(retries).toEqual([{ attempt: 1, delayMs: sleeps[0] }]);
  });

  it("stops immediately on a permanent (non-retryable) failure", async () => {
    const operation = vi.fn(async () => {
      throw new Error("permanent");
    });
    const { sleeps, deps } = fakeDeps();

    await expect(retryWithBackoff(operation, POLICY, () => false, deps)).rejects.toThrow(
      "permanent",
    );

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("is bounded: it never exceeds the configured attempt count", async () => {
    const operation = vi.fn(async () => {
      throw new Error("always down");
    });
    const { sleeps, retries, deps } = fakeDeps();

    await expect(retryWithBackoff(operation, { ...POLICY, attempts: 4 }, () => true, deps)).rejects.toThrow(
      "always down",
    );

    expect(operation).toHaveBeenCalledTimes(4);
    expect(retries).toHaveLength(3); // waits happen between attempts only
    expect(sleeps).toHaveLength(3);
  });

  it("returns the last value when a retryable status persists (caller decides)", async () => {
    const operation = vi.fn(async () => ({ status: 503 }));
    const { deps } = fakeDeps();
    const shouldRetry = ({ value }: { value?: { status: number }; error?: unknown }) =>
      !value || isRetryableStatus(value.status);

    const result = await retryWithBackoff(operation, { ...POLICY, attempts: 2 }, shouldRetry, deps);

    expect(result.status).toBe(503);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially and is capped", () => {
    expect(backoffDelay(1, { ...POLICY, jitter: 0 }, () => 0.5)).toBe(100);
    expect(backoffDelay(2, { ...POLICY, jitter: 0 }, () => 0.5)).toBe(200);
    expect(backoffDelay(3, { ...POLICY, jitter: 0 }, () => 0.5)).toBe(400);
    expect(backoffDelay(10, { ...POLICY, jitter: 0 }, () => 0.5)).toBe(1_000);
  });

  it("applies symmetric jitter within ± the configured fraction", () => {
    const low = backoffDelay(1, POLICY, () => 0);
    const mid = backoffDelay(1, POLICY, () => 0.5);
    const high = backoffDelay(1, POLICY, () => 1);

    expect(low).toBe(75); // 100 - 25
    expect(mid).toBe(100);
    expect(high).toBe(125); // 100 + 25
  });

  it("never returns a negative delay", () => {
    expect(backoffDelay(1, { attempts: 2, baseDelayMs: 0, maxDelayMs: 0, jitter: 1 }, () => 0)).toBe(0);
  });
});

describe("isRetryableStatus", () => {
  it("treats throttling and server errors as transient", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("treats other 4xx as permanent", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});
