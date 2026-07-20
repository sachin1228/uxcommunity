import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * Public (user-authenticated) endpoint that returns all lottie settings.
 * The client uses these to resolve the correct animation for a given community.
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
  return NextResponse.json({ settings: data ?? [] });
}
