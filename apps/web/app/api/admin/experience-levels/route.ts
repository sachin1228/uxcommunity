import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const DEFAULT_LEVELS = [
  { slug: "student",        name: "Students" },
  { slug: "fresher",        name: "Freshers" },
  { slug: "junior",         name: "Junior Designers" },
  { slug: "mid_level",      name: "Mid-Level Designers" },
  { slug: "senior",         name: "Senior Designers" },
  { slug: "lead",           name: "Lead Designers" },
  { slug: "principal",      name: "Principal Designers" },
  { slug: "staff",          name: "Staff Designers" },
  { slug: "design_manager", name: "Design Managers" },
  { slug: "head_of_design", name: "Heads of Design" },
  { slug: "director",       name: "Design Directors" },
  { slug: "vp",             name: "VP of Design" },
  { slug: "consultant",     name: "Design Consultants" },
  { slug: "freelancer",     name: "Freelancers" },
];

export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const db = createServiceClient();

  let { data, error } = await db
    .from("experience_levels")
    .select("id, slug, name, image_url, created_at")
    .order("name");

  if (error) return NextResponse.json({ error: "Failed to fetch experience levels." }, { status: 500 });

  // Auto-seed: if the table is empty, insert the default levels and re-fetch
  if (!data || data.length === 0) {
    await db.from("experience_levels").upsert(
      DEFAULT_LEVELS,
      { onConflict: "slug", ignoreDuplicates: true }
    );
    const refetch = await db
      .from("experience_levels")
      .select("id, slug, name, image_url, created_at")
      .order("name");
    data = refetch.data ?? [];
  }

  // Wrap with is_active: true so MasterDataPage renders correctly (experience levels are always active)
  return NextResponse.json({ experience_levels: (data ?? []).map((r) => ({ ...r, is_active: true, updated_at: r.created_at })) });
}
