/**
 * Unit tests for `resolveSessionConfig`.
 *
 * A missing or unusable signing secret must be reported as UNCONFIGURED so the
 * upgrade handler fails closed AND logs that it is misconfigured, instead of
 * refusing every handshake in the app with an unexplained 401.
 */

import { describe, expect, it } from "vitest";
import { resolveSessionConfig } from "../src/session-config";

describe("resolveSessionConfig", () => {
  it("treats an unset secret as unconfigured (fail closed)", () => {
    expect(resolveSessionConfig({}).configured).toBe(false);
    expect(resolveSessionConfig({ SESSION_SECRET: undefined }).configured).toBe(false);
    expect(resolveSessionConfig({ SESSION_SECRET: null }).configured).toBe(false);
  });

  it("treats a non-string or empty secret as unconfigured", () => {
    expect(resolveSessionConfig({ SESSION_SECRET: 12345 }).configured).toBe(false);
    expect(resolveSessionConfig({ SESSION_SECRET: "" }).configured).toBe(false);
    expect(resolveSessionConfig({ SESSION_SECRET: "   " }).configured).toBe(false);
    expect(resolveSessionConfig({ SESSION_SECRET: "\n" }).configured).toBe(false);
  });

  it("accepts a usable secret", () => {
    expect(resolveSessionConfig({ SESSION_SECRET: "s3cret-value" })).toEqual({
      configured: true,
      secret: "s3cret-value",
    });
  });

  it("trims whitespace, so an `echo`-deployed secret still matches the web app", () => {
    // A trailing newline is what `echo "$SECRET" | wrangler secret put` adds;
    // left in place it signs JWTs the web app cannot verify.
    expect(resolveSessionConfig({ SESSION_SECRET: "s3cret-value\n" })).toEqual({
      configured: true,
      secret: "s3cret-value",
    });
    expect(resolveSessionConfig({ SESSION_SECRET: "  s3cret-value  " })).toEqual({
      configured: true,
      secret: "s3cret-value",
    });
  });
});
