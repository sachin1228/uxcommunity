/**
 * Public endpoint — returns active job titles for the signup form.
 * Uses the name stored in the DB so admin renames are reflected here.
 * No auth required.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("job_titles")
    .select("id, slug, name, image_url, is_active")
    .eq("is_active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch job titles" }, { status: 500 });
  }

  const jobTitles = (data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.name,
    image_url: r.image_url ?? null,
  }));

  return NextResponse.json({ job_titles: jobTitles });
}
