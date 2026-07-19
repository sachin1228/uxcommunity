import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { masterDataSchema } from "@/lib/validations";
import { z } from "zod";

const patchSchema = masterDataSchema
  .extend({ is_active: z.boolean().optional() })
  .partial();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data, error } = await db
    .from("design_interests")
    .select("id, name, image_url, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to fetch interest." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Interest not found." }, { status: 404 });
  return NextResponse.json({ interest: data });
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
  const db = createServiceClient();
  const { data, error } = await db
    .from("design_interests")
    .update(parsed.data)
    .eq("id", id)
    .select("id, name, image_url, is_active, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An interest with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update interest." }, { status: 500 });
  }
  return NextResponse.json({ interest: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { error } = await db.from("design_interests").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Cannot delete: this interest is linked to user profiles. Deactivate it instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to delete interest." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
