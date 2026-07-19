/**
 * Public endpoint — returns experience levels with image_url for the signup form.
 * No auth required.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

const LEVEL_LABELS: Record<string, string> = {
  student:        "Student",
  fresher:        "Fresher (0–1 Years)",
  junior:         "Junior Designer (1–3 Years)",
  mid_level:      "Mid-Level Designer (3–5 Years)",
  senior:         "Senior Designer (5–8 Years)",
  lead:           "Lead Designer (8–12 Years)",
  principal:      "Principal Designer",
  staff:          "Staff Designer",
  design_manager: "Design Manager",
  head_of_design: "Head of Design",
  director:       "Director of Design",
  vp:             "VP of Design",
  consultant:     "Design Consultant",
  freelancer:     "Freelancer",
};

export async function GET() {
  const db = createServiceClient();
  const { data, error } = await db
    .from("experience_levels")
    .select("id, slug, name, image_url")
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch experience levels" }, { status: 500 });
  }

  // Use the display label from the constant (more descriptive than DB name)
  const levels = (data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: LEVEL_LABELS[r.slug] ?? r.name,
    image_url: r.image_url ?? null,
  }));

  return NextResponse.json({ experience_levels: levels });
}
