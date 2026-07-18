import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET(
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

  const { data: user, error } = await db
    .from("users")
    .select(`
      id, name, email, is_blocked, created_at, application_id,
      designer_profiles (
        experience_level,
        companies ( name ),
        cities ( name ),
        design_sectors ( name )
      )
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[admin/users] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch user." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Fetch application URLs if linked
  let application: { linkedin_url: string | null; portfolio_url: string | null } | null = null;
  if (user.application_id) {
    const { data: app } = await db
      .from("applications")
      .select("linkedin_url, portfolio_url")
      .eq("id", user.application_id)
      .maybeSingle();
    application = app ?? null;
  }

  return NextResponse.json({ user, application });
}

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

  // Fetch application_id before deleting — we hard-delete it last.
  const { data: user } = await db
    .from("users")
    .select("application_id")
    .eq("id", id)
    .maybeSingle();

  // 1. Delete designer profile
  await db.from("designer_profiles").delete().eq("user_id", id);

  // 2. Delete user (must come before application due to FK ON DELETE RESTRICT)
  const { error } = await db.from("users").delete().eq("id", id);

  if (error) {
    console.error("[admin/users] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete user." }, { status: 500 });
  }

  // 3. Hard-delete the application so the email is completely free to reapply
  if (user?.application_id) {
    await db.from("applications").delete().eq("id", user.application_id);
  }

  return NextResponse.json({ success: true });
}
