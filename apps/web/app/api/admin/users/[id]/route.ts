import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";

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
        experience_level, avatar_url, avatar_source,
        cities ( name ),
        design_sectors ( name )
      )
    `)
    .eq("id", id)
    .maybeSingle();

  // Fetch interests separately (join table)
  const { data: interestRows } = await db
    .from("user_interests")
    .select("design_interests ( id, name )")
    .eq("user_id", id);

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

  const interests = (interestRows ?? [])
    .map((r) => {
      const di = r.design_interests as unknown as { id: string; name: string } | null;
      return di ? { id: di.id, name: di.name } : null;
    })
    .filter(Boolean);

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

  return NextResponse.json({ user, application, interests, memberOfAllCommunities });
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

  // Fetch application_id + email + avatar before deleting — needed to clean
  // up the application record (email free to reapply) and the R2 avatar.
  const { data: user } = await db
    .from("users")
    .select("application_id, email")
    .eq("id", id)
    .maybeSingle();
  // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
  const { data: profile } = (await db
    .from("designer_profiles")
    .select("avatar_url")
    .eq("user_id", id)
    .maybeSingle()) as unknown as { data: { avatar_url: string | null } | null };
  const avatarUrl = profile?.avatar_url ?? null;

  // 1. Delete designer profile
  await db.from("designer_profiles").delete().eq("user_id", id);

  // 2. Delete user (must come before application due to FK ON DELETE RESTRICT)
  const { error } = await db.from("users").delete().eq("id", id);

  if (error) {
    console.error("[admin/users] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete user." }, { status: 500 });
  }

  // 3. Hard-delete the application so the email is completely free to reapply.
  // Delete by application_id first (precise); then fall back to email to catch
  // any orphaned rows where application_id was null or not linked correctly.
  if (user?.application_id) {
    await db.from("applications").delete().eq("id", user.application_id);
  } else if (user?.email) {
    await db
      .from("applications")
      .delete()
      .eq("applicant_email", user.email.toLowerCase());
  }

  // Guarantee: even if application_id was set and deleted above, also sweep by
  // email to remove any duplicate / orphaned application rows for this address.
  if (user?.application_id && user?.email) {
    await db
      .from("applications")
      .delete()
      .eq("applicant_email", user.email.toLowerCase());
  }

  // Delete the uploaded avatar from R2 unless another row still references it.
  if (avatarUrl) {
    try {
      const outcome = await deleteR2AssetIfUnreferenced(db, avatarUrl, [
        { table: "designer_profiles", column: "avatar_url" },
      ]);
      if (outcome.status !== "deleted" && outcome.status !== "referenced") {
        console.warn("[admin/users] avatar cleanup outcome:", outcome.status);
      }
    } catch (avatarCleanupError) {
      // Non-fatal: re-run via the admin orphan scan (Tools → R2 storage health).
      console.error("[admin/users] avatar cleanup error:", avatarCleanupError);
    }
  }

  return NextResponse.json({ success: true });
}
