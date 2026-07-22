import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * Public (user-authenticated) endpoint that returns all lottie settings.
 * The client uses these to resolve the correct animation for a given community.
 *
 * Each setting now includes `animation_data` — the parsed Lottie JSON fetched
 * server-side from R2.  This avoids a cross-origin browser fetch to R2 which
 * would be blocked by CORS and silently fall back to the spinner.
 */
export async function GET() {
  try { await requireSession("user"); } catch (e) { return e as Response; }

  const db = createServiceClient();
  const { data, error } = await db
    .from("lottie_settings")
    .select("id, scope, scope_key, lottie_url");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch lottie settings." }, { status: 500 });
  }

  const rows = data ?? [];

  // Fetch each Lottie JSON from R2 on the server to avoid browser CORS issues.
  // Lottie files are small (< 2 MB) so embedding them inline is fine.
  const settings = await Promise.all(
    rows.map(async (row) => {
      try {
        const res = await fetch(row.lottie_url);
        if (!res.ok) return { ...row, animation_data: null };
        const animation_data = await res.json();
        return { ...row, animation_data };
      } catch {
        return { ...row, animation_data: null };
      }
    })
  );

  return NextResponse.json({ settings });
}
