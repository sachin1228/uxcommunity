import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { masterDataSchema } from "@/lib/validations";

export async function GET() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const db = createServiceClient();

  const { data, error } = await db
    .from("job_titles")
    .select("id, slug, name, image_url, is_active, created_at, updated_at")
    .order("name")
    .limit(500); // safety cap — prevents unbounded scans as data grows

  if (error) return NextResponse.json({ error: "Failed to fetch job titles." }, { status: 500 });

  return NextResponse.json({
    job_titles: (data ?? []).map((r) => ({
      ...r,
      // Graceful fallback if migration hasn't been applied yet
      is_active: r.is_active ?? true,
      updated_at: r.updated_at ?? r.created_at,
    })),
  });
}

/** Converts a display name to a URL-safe slug, e.g. "UX Designer" → "ux_designer" */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function POST(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const parsed = masterDataSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("job_titles")
    .insert({
      name:      parsed.data.name,
      slug:      toSlug(parsed.data.name),
      image_url: parsed.data.image_url ?? null,
    })
    .select("id, slug, name, image_url, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A job title with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create job title." }, { status: 500 });
  }

  revalidateTag("master-images", {});
  return NextResponse.json({
    job_title: { ...data, is_active: true, updated_at: data.created_at },
  }, { status: 201 });
}
