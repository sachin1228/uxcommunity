/**
 * Public endpoint — returns active companies for dropdowns.
 * No auth required.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("companies")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 });
  }
  return NextResponse.json({ companies: data });
}
