import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { masterDataSchema } from "@/lib/validations";
import { z } from "zod";

const patchSchema = masterDataSchema
  .extend({ is_active: z.boolean().optional() })
  .partial();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

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
    .from("companies")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A company with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update company." }, { status: 500 });
  }

  return NextResponse.json({ company: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const db = createServiceClient();

  // Soft-delete: set is_active = false
  const { error } = await db
    .from("companies")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to deactivate company." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
