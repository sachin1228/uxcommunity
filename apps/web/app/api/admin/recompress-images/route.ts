import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";

export interface RecompressResult {
  id: string | null;
  table: string;
  oldUrl: string;
  newUrl: string | null;
  status: "compressed" | "skipped" | "failed";
  reason?: string;
}

/**
 * Deferred on the Cloudflare Workers runtime: this route relied on the native
 * `sharp` binary (unsupported in workerd). Re-implement when a server-side
 * image pipeline (e.g. WASM libs or Cloudflare Images) is wired up, or run it
 * as a one-off Node script.
 */
export async function POST() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  return NextResponse.json(
    { error: "recompress-images is unavailable on the Cloudflare Workers runtime." },
    { status: 503 },
  );
}