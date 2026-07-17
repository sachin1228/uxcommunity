import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

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
  const body = await request.json().catch(() => ({}));
  const { is_blocked } = body as { is_blocked?: boolean };

  if (typeof is_blocked !== "boolean") {
    return NextResponse.json({ error: "is_blocked must be a boolean." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("users")
    .update({ is_blocked })
    .eq("id", id)
    .select("id, name, email, is_blocked")
    .single();

  if (error) {
    console.error("[admin/users] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update user." }, { status: 500 });
  }

  return NextResponse.json({ user: data });
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

  // Fetch application_id before deleting — we'll hard-delete it last.
  const { data: user } = await db
    .from("users")
    .select("application_id")
    .eq("id", id)
    .maybeSingle();

  // 1. Delete designer profile
  await db.from("designer_profiles").delete().eq("user_id", id);

  // 2. Delete user (must happen before application due to FK ON DELETE RESTRICT)
  const { error } = await db.from("users").delete().eq("id", id);

  if (error) {
    console.error("[admin/users] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete user." }, { status: 500 });
  }

  // 3. Delete the application — removes all traces so the email is fully clean
  if (user?.application_id) {
    await db.from("applications").delete().eq("id", user.application_id);
  }

  return NextResponse.json({ success: true });
}
