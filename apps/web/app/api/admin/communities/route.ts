import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/** Admin-only: returns all communities (no membership filter) */
export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();
  const { data, error } = await db
    .from("communities")
    .select("id, name, type, image_url")
    .order("type")
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  }
  return NextResponse.json({ communities: data ?? [] });
}
