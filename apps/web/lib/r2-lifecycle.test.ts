import test from "node:test";
import assert from "node:assert/strict";

import {
  collectR2Keys,
  shouldDeletePreviousR2Asset,
  getR2KeyFromUrl,
  normalizeR2DeleteKeys,
} from "./r2";

test("collectR2Keys deduplicates and ignores non-R2 URLs", () => {
  const base = "https://example.r2.dev";
  process.env.R2_PUBLIC_URL = base;

  const urls = [
    `${base}/avatars/user-1/a.png`,
    `${base}/avatars/user-1/a.png`,
    "https://images.example.com/other.png",
    null,
    undefined,
  ];

  assert.deepEqual(collectR2Keys(urls), ["avatars/user-1/a.png"]);
});

test("shouldDeletePreviousR2Asset only when the replacement is different and real", () => {
  process.env.R2_PUBLIC_URL = "https://example.r2.dev";

  assert.equal(shouldDeletePreviousR2Asset("https://example.r2.dev/avatars/user-1/old.png", "https://example.r2.dev/avatars/user-1/new.png"), true);
  assert.equal(shouldDeletePreviousR2Asset("https://example.r2.dev/avatars/user-1/old.png", "https://example.r2.dev/avatars/user-1/old.png"), false);
  assert.equal(shouldDeletePreviousR2Asset(null, "https://example.r2.dev/avatars/user-1/new.png"), false);
  assert.equal(shouldDeletePreviousR2Asset("https://images.example.com/other.png", "https://example.r2.dev/avatars/user-1/new.png"), false);
});

test("getR2KeyFromUrl extracts the object key from the configured public base", () => {
  process.env.R2_PUBLIC_URL = "https://example.r2.dev";

  assert.equal(getR2KeyFromUrl("https://example.r2.dev/avatars/user-1/a.png"), "avatars/user-1/a.png");
  assert.equal(getR2KeyFromUrl("https://other.example.com/avatars/user-1/a.png"), null);
});

test("normalizeR2DeleteKeys accepts only exact object keys and strips invalid input", () => {
  process.env.R2_PUBLIC_URL = "https://example.r2.dev";

  assert.deepEqual(normalizeR2DeleteKeys([
    "avatars/user-1/a.png",
    "avatars/user-1/a.png",
    "https://example.r2.dev/avatars/user-1/b.png",
    "../secret",
    "",
    "*",
    null,
    undefined,
  ]), ["avatars/user-1/a.png"]);
});
