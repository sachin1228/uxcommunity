import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";

/**
 * GET /api/admin/transcoder-health
 *
 * Proxies the transcoder worker(s) /health endpoint for the admin dashboard.
 * Configure `TRANSCODER_HEALTH_URL` (comma-separated for multiple workers,
 * e.g. "http://transcoder-1:9090,http://transcoder-2:9090"). The web app
 * runs on Cloudflare Workers, so the fetch is server-side — the transcoder
 * URL is never exposed to browsers.
 *
 * Response shape:
 *   { configured: boolean, workers: Array<{ url, ok, status, payload?, error? }> }
 */

export async function GET() {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const raw = process.env.TRANSCODER_HEALTH_URL?.trim() ?? "";
  const urls = raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  if (urls.length === 0) {
    return NextResponse.json({
      configured: false,
      workers: [],
      hint: "Set TRANSCODER_HEALTH_URL (e.g. http://transcoder-1:9090) to monitor the video transcoder.",
    });
  }

  const workers = await Promise.all(
    urls.map(async (url) => {
      const base = url.replace(/\/+$/, "");
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${base}/health`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        clearTimeout(timer);
        const payload = await response.json().catch(() => null);
        const ok = response.ok && payload?.status === "ok";
        return {
          url: base,
          ok,
          status: response.status,
          payload,
          error: ok ? null : `HTTP ${response.status}${payload?.status ? ` (${payload.status})` : ""}`,
        };
      } catch (error) {
        return {
          url: base,
          ok: false,
          status: 0,
          payload: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return NextResponse.json({ configured: true, workers });
}