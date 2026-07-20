import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { z } from "zod";

const patchSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  image_url: z.string().url().nullable().optional(),
  is_active: z.boolean().optional(),
}).partial();

function shape(r: Record<string, unknown>) {
  return {
    ...r,
    is_active:  r.is_active  ?? true,
    updated_at: r.updated_at ?? r.created_at,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data, error } = await db
    .from("experience_levels")
    .select("id, slug, name, image_url, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to fetch experience level." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Experience level not found." }, { status: 404 });
  return NextResponse.json({ experience_level: shape(data) });
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

  const { name, image_url, is_active } = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (name      !== undefined) updateData.name      = name;
  if (image_url !== undefined) updateData.image_url = image_url;
  if (is_active !== undefined) updateData.is_active = is_active;

  if (!Object.keys(updateData).length) {
    const { data } = await createServiceClient()
      .from("experience_levels")
      .select("id, slug, name, image_url, is_active, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();
    return NextResponse.json({ experience_level: data ? shape(data) : null });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("experience_levels")
    .update(updateData)
    .eq("id", id)
    .select("id, slug, name, image_url, is_active, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: "Failed to update experience level." }, { status: 500 });
  return NextResponse.json({ experience_level: shape(data) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { error } = await db.from("experience_levels").delete().eq("id", id);
  if (error) {
    // FK violation — a designer profile still references this level
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Cannot delete — one or more designer profiles reference this experience level." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to delete experience level." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
