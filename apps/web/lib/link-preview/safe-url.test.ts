import test from "node:test";
import assert from "node:assert/strict";

import { assertPublicUrl } from "./safe-url";

function check(url: string): URL {
  return assertPublicUrl(new URL(url));
}

function assertBlocked(url: string) {
  assert.throws(() => check(url), /bad protocol|credentials in url|empty host|private host/, url);
}

test("public http(s) destinations are allowed", () => {
  assert.equal(check("https://example.com/articles/design").hostname, "example.com");
  assert.equal(check("http://8.8.8.8/").hostname, "8.8.8.8");
  assert.equal(check("https://93.184.216.34/").hostname, "93.184.216.34");
  assert.equal(check("https://[2001:4860:4860::8888]/").hostname, "[2001:4860:4860::8888]");
  // Boundaries are exclusive: these sit outside the private blocks.
  assert.equal(check("http://172.15.0.1/").hostname, "172.15.0.1");
  assert.equal(check("http://172.32.0.1/").hostname, "172.32.0.1");
});

test("loopback, private, link-local and metadata IPv4 are refused", () => {
  for (const host of [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "192.0.2.10",
    "198.18.0.1",
    "203.0.113.5",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assertBlocked(`http://${host}/`);
  }
});

test("loopback, unique-local and link-local IPv6 are refused", () => {
  for (const host of ["[::1]", "[::]", "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[::ffff:127.0.0.1]"]) {
    assertBlocked(`http://${host}/`);
  }
});

test("single-label hosts and private suffixes are refused", () => {
  for (const host of ["localhost", "intranet", "router.lan", "printer.local", "db.internal", "x.home.arpa"]) {
    assertBlocked(`http://${host}/`);
  }
});

test("decimal, octal and hex host encodings are refused", () => {
  assertBlocked("http://2130706433/");
  assertBlocked("http://0x7f.0.0.1/");
});

test("non-http schemes and embedded credentials are refused", () => {
  assertBlocked("ftp://example.com/file");
  assertBlocked("file:///etc/passwd");
  assertBlocked("http://user:secret@example.com/");
});

test("a public URL keeps its path and query", () => {
  const url = check("https://example.com/a/b?c=d");
  assert.equal(url.pathname, "/a/b");
  assert.equal(url.search, "?c=d");
});
