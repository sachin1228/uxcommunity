import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { sessionCookieOptions } from "@/lib/auth/cookie-domain";

const requireConfig = createRequire(import.meta.url);

test("app config exposes a report-only CSP with explicit delivery origins", async () => {
  const config = requireConfig("../../next.config.js") as {
    headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
  };
  const groups = await config.headers();
  const baseline = groups.find((group) => group.source === "/(.*)");
  const csp = baseline?.headers.find((header) => header.key === "Content-Security-Policy-Report-Only");
  assert.ok(csp, "report-only CSP is configured");
  assert.match(csp.value, /default-src 'self'/);
  assert.match(csp.value, /connect-src[^;]*https:\/\/rt\.uxcommunity\.in/);
  assert.match(csp.value, /frame-ancestors 'none'/);
});

test("session cookie keeps HttpOnly/SameSite and the realtime-compatible domain", () => {
  const options = sessionCookieOptions({
    host: "app.uxcommunity.in",
    appUrl: "https://app.uxcommunity.in",
    secure: true,
    maxAge: 604800,
  });
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.secure, true);
  assert.equal(options.domain, ".uxcommunity.in");
  assert.equal(options.path, "/");
});

test("localhost stays host-only", () => {
  const options = sessionCookieOptions({
    host: "localhost:3000",
    appUrl: "https://app.uxcommunity.in",
    secure: false,
    maxAge: 60,
  });
  assert.equal(options.domain, undefined);
});
