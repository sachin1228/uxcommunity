/**
 * Public endpoint — returns active cities for dropdowns.
 * No auth required.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("cities")
    .select("id, name, image_url")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch cities" }, { status: 500 });
  }
  return NextResponse.json({ cities: data });
}
