/**
 * Unit tests for `resolveMembershipConfig` (production-readiness audit, M-8).
 *
 * Missing or unusable authorization configuration must be reported as
 * UNCONFIGURED so the caller fails closed, instead of silently granting access.
 */

import { describe, expect, it } from "vitest";
import { resolveMembershipConfig } from "../src/membership-config";

describe("resolveMembershipConfig", () => {
  it("treats an unset API_URL as unconfigured (fail closed)", () => {
    expect(resolveMembershipConfig({}).configured).toBe(false);
    expect(resolveMembershipConfig({ API_URL: undefined }).configured).toBe(false);
    expect(resolveMembershipConfig({ API_URL: null }).configured).toBe(false);
  });

  it("treats an empty or whitespace-only API_URL as unconfigured", () => {
    expect(resolveMembershipConfig({ API_URL: "" }).configured).toBe(false);
    expect(resolveMembershipConfig({ API_URL: "   " }).configured).toBe(false);
  });

  it("treats a non-URL value as unconfigured", () => {
    expect(resolveMembershipConfig({ API_URL: "not a url" }).configured).toBe(false);
    expect(resolveMembershipConfig({ API_URL: "ftp://example.com" }).configured).toBe(false);
  });

  it("accepts a usable http(s) URL and trims a trailing slash", () => {
    expect(resolveMembershipConfig({ API_URL: "https://app.example.com/" })).toEqual({
      configured: true,
      apiUrl: "https://app.example.com",
    });
    expect(resolveMembershipConfig({ API_URL: "http://127.0.0.1:3000" })).toEqual({
      configured: true,
      apiUrl: "http://127.0.0.1:3000",
    });
  });
});
