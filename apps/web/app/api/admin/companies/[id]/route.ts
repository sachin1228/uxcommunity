import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * Admin company update/delete. Both go through the database functions in
 * 20261007140000_company_directory_admin.sql, so the picker (which reads the
 * same tables) reflects the change immediately — deactivating hides a company
 * from search, deleting removes it and its hint entirely.
 */

const patchSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120, "Name is too long").optional(),
    is_active: z.boolean().optional(),
    logo_url: z.string().url().nullable().optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.is_active !== undefined || d.logo_url !== undefined,
    { message: "Nothing to update." }
  );

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
  const { data, error } = await db.rpc("admin_update_company", {
    p_id: id,
    // `null` is the function's "leave this field as it is" — not "clear it".
    p_name: parsed.data.name ?? null,
    p_is_active: parsed.data.is_active ?? null,
    p_logo_url: parsed.data.logo_url ?? null,
  });

  if (error) {
    if (error.code === "P0001" && error.message === "company_name_taken") {
      return NextResponse.json({ error: "company_name_taken", message: "A company with this name already exists." }, { status: 409 });
    }
    if (error.code === "P0002" || error.code === "22P02") {
      return NextResponse.json({ error: "Company not found." }, { status: 404 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message, message: "Enter a name for the company." }, { status: 422 });
    }
    console.error("[admin/companies] update failed:", error);
    return NextResponse.json({ error: "Failed to update company." }, { status: 500 });
  }

  return NextResponse.json({ company: (data ?? [])[0] ?? null });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const { id } = await params;
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_delete_company", { p_id: id });

  if (error) {
    if (error.code === "22P02") {
      return NextResponse.json({ error: "Company not found." }, { status: 404 });
    }
    console.error("[admin/companies] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete company." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
