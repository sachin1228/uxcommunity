import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import type { LinkPreviewData } from "@/lib/communities/linkPreview";

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

// ── Route ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Must be an authenticated user — we don't want an open proxy.
  try { await requireSession("user"); } catch (e) { return e as Response; }

  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  // Validate: only http/https, no private/loopback hosts
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("bad protocol");
    }
    const h = parsed.hostname;
    if (
      h === "localhost" ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h === "::1"
    ) {
      return NextResponse.json({ error: "Forbidden host" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const cacheKey = rawUrl;

  // Return cached result if still fresh
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(rawUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; DraftHubPreviewBot/1.0)",
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
