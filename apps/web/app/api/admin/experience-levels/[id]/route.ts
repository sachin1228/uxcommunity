import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  image_url: z.string().url().nullable().optional(),
}).partial();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data, error } = await db
    .from("experience_levels")
    .select("id, slug, name, image_url, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to fetch experience level." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Experience level not found." }, { status: 404 });
  return NextResponse.json({ experience_level: { ...data, is_active: true, updated_at: data.created_at } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }
  // Only allow updating name and image_url; ignore is_active (always true)
  const { name, image_url } = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (image_url !== undefined) updateData.image_url = image_url;

  if (!Object.keys(updateData).length) {
    // Nothing to update — just return current data
    const { data } = await createServiceClient()
      .from("experience_levels").select("id, slug, name, image_url, created_at").eq("id", id).maybeSingle();
    return NextResponse.json({ experience_level: data ? { ...data, is_active: true, updated_at: data.created_at } : null });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("experience_levels")
    .update(updateData)
    .eq("id", id)
    .select("id, slug, name, image_url, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Failed to update experience level." }, { status: 500 });
  return NextResponse.json({ experience_level: { ...data, is_active: true, updated_at: data.created_at } });
}

// Experience levels are seeded from the PG enum — deletion is intentionally blocked
export async function DELETE() {
  return NextResponse.json(
    { error: "Experience levels cannot be deleted — they are tied to the database enum." },
    { status: 409 }
  );
}
