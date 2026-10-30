import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  normalizePreviewUrl,
  type LinkPreviewData,
} from "@/lib/communities/linkPreview";

// ── Module-level in-memory cache (survives across requests in the same process) ──
const cache = new Map<string, { data: LinkPreviewData; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const CACHE_MAX    = 500;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_HTML_BYTES   = 60_000; // read first 60 KB — enough for <head>

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Pull a meta-tag content value by property or name attribute. */
function getMeta(html: string, key: string): string | null {
  // <meta property="…" content="…">  or  <meta name="…" content="…">
  // attribute order is not guaranteed, so we match both orderings.
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
    "i",
  );
  const m = html.match(pattern);
  return (m?.[1] ?? m?.[2] ?? "").trim() || null;
}

function resolveUrl(href: string, origin: string): string | null {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `${origin}${href}`;
  return `${origin}/${href}`;
}

function parseHtml(html: string, pageUrl: string): LinkPreviewData {
  const { origin } = new URL(pageUrl);

  const ogTitle       = getMeta(html, "og:title");
  const twTitle       = getMeta(html, "twitter:title");
  const titleMatch    = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const pageTitle     = titleMatch?.[1]?.trim() ?? null;

  const ogDesc        = getMeta(html, "og:description");
  const twDesc        = getMeta(html, "twitter:description");
  const metaDesc      = getMeta(html, "description");

  const ogImage       = getMeta(html, "og:image");
  const twImage       = getMeta(html, "twitter:image");
  const ogSiteName    = getMeta(html, "og:site_name");

  const rawImage      = ogImage ?? twImage ?? null;
  const image         = rawImage ? resolveUrl(rawImage, origin) : null;

  const siteName =
    ogSiteName?.trim() ||
    new URL(pageUrl).hostname.replace(/^www\./, "");

  return {
    url:         pageUrl,
    title:       (ogTitle ?? twTitle ?? pageTitle)?.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') ?? null,
    description: (ogDesc ?? twDesc ?? metaDesc)?.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') ?? null,
    image,
    siteName,
  };
}

/** Evict the oldest entries once the cache grows beyond CACHE_MAX. */
function trimCache() {
  if (cache.size <= CACHE_MAX) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (let i = 0; i < sorted.length - CACHE_MAX; i++) {
    cache.delete(sorted[i][0]);
  }
}

// ── SSRF guard ────────────────────────────────────────────────────────────────

/** Host suffixes that can only resolve inside a private network. */
const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa", ".localdomain"];

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isPrivateIpv4(host: string): boolean {
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

function isPrivateIpv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith("fc") || host.startsWith("fd")) {
    return true; // unique local fc00::/7
  }
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/**
 * Rejects any URL that is not a public http(s) destination.
 *
 * Redirects are followed by hand (see `safeFetch`) so this same check runs on
 * every hop — `fetch`'s automatic redirect handling would let an attacker
 * bounce from a public host to 169.254.169.254 or a private range.
 */
function assertPublicUrl(input: URL): URL {
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
async function safeFetch(
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

// ── Route ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Must be an authenticated user — we don't want an open proxy.
  try { await requireSession("user", { allowUnverified: true }); } catch (e) { return e as Response; }

  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  // Validate: public http(s) only, no private/loopback/metadata destinations.
  let parsed: URL;
  try {
    parsed = assertPublicUrl(new URL(rawUrl));
  } catch {
    return NextResponse.json({ error: "Invalid or forbidden URL" }, { status: 400 });
  }

  // Cache by normalized URL so equivalent spellings (case, trailing slash,
  // hash, query order) share one entry instead of refetching upstream.
  const cacheKey = normalizePreviewUrl(rawUrl);

  // Return cached result if still fresh. Echo the requester's own URL in the
  // response so data.url always matches what was asked for, even when the
  // cache entry was populated by an equivalent spelling.
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(
      hit.data.url === rawUrl ? hit.data : { ...hit.data, url: rawUrl },
      {
        headers: { "Cache-Control": "public, max-age=300" },
      },
    );
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const { response } = await safeFetch(parsed, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; UXCommunityPreviewBot/1.0)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return NextResponse.json({ error: "Upstream error" }, { status: 422 });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      // Non-HTML resource — return a minimal preview so callers know
      // the URL is reachable but there's nothing to parse.
      const data: LinkPreviewData = {
        url: rawUrl,
        title: parsed.pathname.split("/").filter(Boolean).pop() ?? parsed.hostname,
        description: null,
        image: null,
        siteName: parsed.hostname.replace(/^www\./, ""),
      };
      cache.set(cacheKey, { data, fetchedAt: Date.now() });
      trimCache();
      return NextResponse.json(data);
    }

    // Stream the first MAX_HTML_BYTES only — we just need <head>
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
        if (total >= MAX_HTML_BYTES) {
          reader.cancel().catch(() => {});
          break;
        }
      }
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(merged);

    const data = parseHtml(html, rawUrl);
    cache.set(cacheKey, { data, fetchedAt: Date.now() });
    trimCache();

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "AbortError") {
      return NextResponse.json({ error: "Request timed out" }, { status: 408 });
    }
    console.error("[link-preview]", err);
    return NextResponse.json({ error: "Failed to fetch preview" }, { status: 422 });
  }
}
