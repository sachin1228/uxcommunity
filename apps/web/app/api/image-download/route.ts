import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";

/**
 * Same-origin download proxy for user-uploaded images.
 *
 * The R2 public bucket serves images without CORS headers, so a browser-side
 * fetch → blob download is blocked, and a plain anchor would navigate instead
 * of downloading. This route fetches the object server-side (no CORS applies)
 * and streams it back with `Content-Disposition: attachment`, so clicking the
 * download icon always saves the file — never opens a new tab.
 *
 * Only image URLs on our own storage hosts are proxied (SSRF guard).
 */
function isAllowedImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  // R2 public buckets (pub-xxxx.r2.dev / custom domain) + legacy Supabase storage.
  if (host.endsWith(".r2.dev") || host.endsWith(".supabase.co")) return true;
  try {
    const base = new URL(process.env.R2_PUBLIC_URL ?? "");
    return host === base.hostname;
  } catch {
    return false;
  }
}

/** Derive a safe filename (keeping the extension) from a CDN/object URL. */
function fileNameForUrl(url: string): string {
  try {
    const name = (new URL(url).pathname.split("/").pop() ?? "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return name || "image";
  } catch {
    return "image";
  }
}

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url || !isAllowedImageUrl(url)) {
    return NextResponse.json({ error: "Invalid image URL." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { cache: "no-store", redirect: "manual" });
  } catch {
    return NextResponse.json({ error: "Failed to fetch image." }, { status: 502 });
  }
  if (!upstream.ok || upstream.status >= 300) {
    return NextResponse.json({ error: "Failed to fetch image." }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const body = await upstream.arrayBuffer();
  const filename = fileNameForUrl(url);

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}