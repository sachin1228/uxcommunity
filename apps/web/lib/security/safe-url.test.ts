import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSafeHttpUrl,
  normalizeSafeLinkedInUrl,
  safeExternalUrl,
} from "./safe-url";
import { parseProfileLinkUpdates } from "../profile/urls";

test("rejects every non-http(s) scheme", () => {
  for (const value of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "mailto:someone@example.com",
  ]) {
    assert.equal(normalizeSafeHttpUrl(value), null, value);
    assert.equal(safeExternalUrl(value), null, value);
  }
});

test("rejects credentials, control characters and malformed values", () => {
  assert.equal(normalizeSafeHttpUrl("https://user:pass@example.com"), null);
  assert.equal(normalizeSafeHttpUrl("https://exa\u0000mple.com"), null);
  assert.equal(normalizeSafeHttpUrl("not a url"), null);
  assert.equal(normalizeSafeHttpUrl("http://"), null);
  assert.equal(normalizeSafeHttpUrl(`https://example.com/${"a".repeat(2048)}`), null);
});

test("accepts http(s) and adds https for a bare domain", () => {
  assert.equal(normalizeSafeHttpUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(normalizeSafeHttpUrl("http://example.com"), "http://example.com/");
  assert.equal(
    normalizeSafeHttpUrl("linkedin.com/in/sachin", { allowBareDomain: true }),
    "https://linkedin.com/in/sachin",
  );
  assert.equal(safeExternalUrl("portfolio.example.com"), "https://portfolio.example.com/");
});

test("LinkedIn links must be on linkedin.com", () => {
  assert.equal(
    normalizeSafeLinkedInUrl("https://www.linkedin.com/in/sachin"),
    "https://www.linkedin.com/in/sachin",
  );
  assert.equal(
    normalizeSafeLinkedInUrl("linkedin.com/in/sachin"),
    "https://linkedin.com/in/sachin",
  );
  assert.equal(normalizeSafeLinkedInUrl("https://linkedin.example.com/in/sachin"), null);
  assert.equal(normalizeSafeLinkedInUrl("javascript:alert(1)"), null);
});

test("PATCH body parsing rejects unsafe fields and clears empty ones", () => {
  const rejected = parseProfileLinkUpdates({
    linkedin_url: "javascript:alert(1)",
    portfolio_url: "data:text/html,x",
  });
  assert.deepEqual(rejected.patch, {});
  assert.ok(rejected.errors.linkedin_url);
  assert.ok(rejected.errors.portfolio_url);

  const valid = parseProfileLinkUpdates({
    linkedin_url: "https://linkedin.com/in/sachin",
    portfolio_url: "https://sachin.design",
  });
  assert.deepEqual(valid.errors, {});
  assert.equal(valid.patch.linkedin_url, "https://linkedin.com/in/sachin");
  assert.equal(valid.patch.portfolio_url, "https://sachin.design/");

  const cleared = parseProfileLinkUpdates({
    linkedin_url: "   ",
    portfolio_url: null,
  });
  assert.deepEqual(cleared.errors, {});
  assert.equal(cleared.patch.linkedin_url, null);
  assert.equal(cleared.patch.portfolio_url, null);

  const absent = parseProfileLinkUpdates({});
  assert.deepEqual(absent.patch, {});
});
