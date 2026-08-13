import assert from "node:assert/strict";
import test from "node:test";
import { getFigmaEmbedUrl, parseFigmaUrl } from "./figma.ts";

test("recognizes prototype URLs on trusted Figma hosts", () => {
  assert.equal(parseFigmaUrl("https://www.figma.com/proto/abc/My-Prototype?node-id=1-2")?.kind, "prototype");
  assert.equal(parseFigmaUrl("https://figma.com/proto/abc/My-Prototype")?.kind, "prototype");
});

test("recognizes normal Figma files without making an embed", () => {
  assert.equal(parseFigmaUrl("https://www.figma.com/design/abc/My-Design")?.kind, "file");
  assert.equal(parseFigmaUrl("https://figma.com/file/abc/My-File")?.kind, "file");
  assert.equal(getFigmaEmbedUrl("https://figma.com/design/abc/My-Design"), null);
});

test("builds an official embed URL and preserves prototype navigation", () => {
  const result = getFigmaEmbedUrl("https://www.figma.com/proto/abc/My-Prototype?node-id=1-2&scaling=scale-down");
  assert.ok(result);
  const url = new URL(result);
  assert.equal(url.origin, "https://embed.figma.com");
  assert.equal(url.pathname, "/proto/abc/My-Prototype");
  assert.equal(url.searchParams.get("node-id"), "1-2");
  assert.equal(url.searchParams.get("scaling"), "scale-down");
  assert.equal(url.searchParams.get("embed-host"), "share");
});

test("rejects malformed, unrelated, and spoofed URLs", () => {
  for (const value of ["not a url", "https://example.com/proto/abc/Test", "https://figma.com.evil.test/proto/abc/Test", "javascript:alert(1)"]) {
    assert.equal(parseFigmaUrl(value), null);
    assert.equal(getFigmaEmbedUrl(value), null);
  }
});
