/**
 * Public endpoint — returns active design sectors for dropdowns.
 * No auth required.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("design_sectors")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch sectors" }, { status: 500 });
  }
  return NextResponse.json({ sectors: data });
}
