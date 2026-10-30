import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteAccountCascade } from "@/lib/account/delete";

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
      id, name, email, is_blocked, created_at,
      designer_profiles (
        experience_level, job_title, avatar_url, avatar_source,
        linkedin_url, portfolio_url,
        cities ( name ),
        design_sectors ( name )
      )
    `)
    .eq("id", id)
    .maybeSingle();

  // Resolve the job title slug to its admin-managed display name. The profile
  // column stores a slug (no PostgREST embed), so look it up explicitly.
  const profileRow = user?.designer_profiles as
    | { job_title?: string | null }
    | null
    | undefined;
  let jobTitleName: string | null = null;
  if (profileRow?.job_title) {
    const { data: jobTitle } = await db
      .from("job_titles")
      .select("name")
      .eq("slug", profileRow.job_title)
      .maybeSingle();
    jobTitleName = jobTitle?.name ?? null;
  }

  if (error) {
    console.error("[admin/users] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch user." }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Community membership stats for the "member of all communities" toggle
  const [{ count: totalCommunities }, { count: userCommunities }] = await Promise.all([
    db.from("communities").select("id", { count: "exact", head: true }),
    db.from("community_members").select("community_id", { count: "exact", head: true }).eq("user_id", id),
  ]);

  const memberOfAllCommunities =
    typeof totalCommunities === "number" &&
    typeof userCommunities === "number" &&
    totalCommunities > 0 &&
    userCommunities >= totalCommunities;

  return NextResponse.json({
    user: user
      ? {
          ...user,
          designer_profiles: user.designer_profiles
            ? { ...(user.designer_profiles as Record<string, unknown>), job_title_name: jobTitleName }
            : user.designer_profiles,
        }
      : user,
    memberOfAllCommunities,
  });
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

  try {
    const summary = await deleteAccountCascade(db, id);
    return NextResponse.json({
      success: true,
      communities: {
        transferred: summary.transferred,
        deleted: summary.deleted,
        r2_cleanup: summary.r2Cleanup,
      },
      // Anything the account posted in other members' spaces cascades away
      // with the account; the admin orphan audit reclaims those R2 objects.
    });
  } catch (error) {
    console.error("[admin/users] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete user." }, { status: 500 });
  }
}
