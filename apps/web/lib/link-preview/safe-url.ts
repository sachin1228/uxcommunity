/**
 * Public-destination checks for the link-preview fetch.
 *
 * Extracted from the route so the blocklist can be unit-tested without a
 * Next request. The rules are deliberately conservative: anything that can
 * only resolve inside a network (single-label hosts, private/loopback/
 * link-local ranges, metadata addresses) is refused, and redirects are
 * re-checked hop by hop by `safeFetch`.
 */

/** Host suffixes that can only resolve inside a private network. */
const PRIVATE_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home.arpa",
  ".localdomain",
];

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

export function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 (CGNAT)
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0/24, 192.0.2/24
    (a === 198 && (b === 18 || b === 19 || b === 51)) || // 198.18/15, 198.51.100/24
    (a === 203 && b === 0 && c === 113) || // 203.0.113/24
    a >= 224 // multicast + reserved
  );
}

export function isPrivateIpv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fc") || host.startsWith("fd")) {
    return true; // unique local fc00::/7
  }
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  // WHATWG normalises an IPv4-mapped address to hex groups
  // (::ffff:127.0.0.1 → ::ffff:7f00:1), so decode that form too.
  const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

/**
 * Rejects any URL that is not a public http(s) destination.
 *
 * Redirects are followed by hand (see `safeFetch`) so this same check runs on
 * every hop — `fetch`'s automatic redirect handling would let an attacker
 * bounce from a public host to 169.254.169.254 or a private range.
 */
export function assertPublicUrl(input: URL): URL {
  if (input.protocol !== "http:" && input.protocol !== "https:") {
    throw new Error("bad protocol");
  }
  if (input.username || input.password) {
    throw new Error("credentials in url");
  }

  const host = bareHost(input.hostname);

  if (!host) throw new Error("empty host");
  if (host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error("private host");
  }
  // Single-label hosts can only resolve on an internal network.
  if (!host.includes(".") && !host.includes(":")) {
    throw new Error("private host");
  }
  // Decimal/octal/hex IPv4 encodings (e.g. 2130706433, 0x7f.0.0.1).
  if (/^\d+$/.test(host) || host.split(".").some((part) => /^0x[0-9a-f]+$/i.test(part))) {
    throw new Error("private host");
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error("private host");
  }

  return input;
}

/** Fetch a URL while re-validating every redirect hop. */
export async function safeFetch(
  start: URL,
  init: RequestInit,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = assertPublicUrl(start);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current.toString(), { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current };
      current = assertPublicUrl(new URL(location, current));
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error("too many redirects");
}
