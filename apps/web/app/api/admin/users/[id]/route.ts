import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import { ALL_MEDIA_LOOKUPS, cleanupCommunityMedia, collectCommunityMediaUrls } from "@/lib/r2-cleanup";

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
        experience_level, job_title, avatar_url, avatar_source,
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

  return NextResponse.json({
    user: user
      ? {
          ...user,
          designer_profiles: user.designer_profiles
            ? { ...(user.designer_profiles as Record<string, unknown>), job_title_name: jobTitleName }
            : user.designer_profiles,
        }
      : user,
    application,
    interests,
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

  // Split the communities this account owns into the two outcomes the
  // BEFORE DELETE trigger on `users` will produce (see
  // 20260913150000_community_ownership_on_user_delete.sql): handed to the
  // longest-standing remaining member, or deleted when nobody is left. We need
  // to know which ones disappear BEFORE the cascade, because their R2 media
  // URLs become unrecoverable afterwards and the trigger cannot touch R2.
  const { data: ownedRows } = await db
    .from("communities")
    .select("id, name")
    .eq("owner_id", id);

  const transferred: Array<{ id: string; name: string; new_owner_id: string }> = [];
  const removed: Array<{ id: string; name: string; urls: string[] }> = [];

  for (const community of (ownedRows ?? []) as Array<{ id: string; name: string }>) {
    const { data: successor } = await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", community.id)
      .neq("user_id", id)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (successor?.user_id) {
      transferred.push({ id: community.id, name: community.name, new_owner_id: successor.user_id });
    } else {
      removed.push({
        id: community.id,
        name: community.name,
        urls: await collectCommunityMediaUrls(db, community.id),
      });
    }
  }

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
  // Checked against every media column, not just the profile, so an avatar that
  // is also used elsewhere is never removed out from under a live reference.
  if (avatarUrl) {
    try {
      const outcome = await deleteR2AssetIfUnreferenced(db, avatarUrl, ALL_MEDIA_LOOKUPS);
      if (outcome.status !== "deleted" && outcome.status !== "referenced") {
        console.warn("[admin/users] avatar cleanup outcome:", outcome.status);
      }
    } catch (avatarCleanupError) {
      // Non-fatal: re-run via the admin orphan scan (Tools → R2 storage health).
      console.error("[admin/users] avatar cleanup error:", avatarCleanupError);
    }
  }

  // Reclaim the R2 media of every owned community the delete removed. Runs
  // after the cascade, so each object is deleted only when nothing in the
  // database still references it (shared media is skipped). Non-fatal — the
  // orphan audit retries anything that fails here.
  const communityCleanup: Array<{
    community_id: string;
    deleted: number;
    skipped: number;
    failed: number;
  }> = [];
  for (const community of removed) {
    try {
      const cleanup = await cleanupCommunityMedia(db, community.id, community.urls);
      communityCleanup.push({
        community_id: community.id,
        deleted: cleanup.deleted.length,
        skipped: cleanup.skipped.length,
        failed: cleanup.failed.length,
      });
    } catch (cleanupError) {
      console.error("[admin/users] community R2 cleanup error:", cleanupError);
      communityCleanup.push({
        community_id: community.id,
        deleted: 0,
        skipped: 0,
        failed: community.urls.length,
      });
    }
  }

  return NextResponse.json({
    success: true,
    communities: {
      // Kept alive: ownership handed to the longest-standing remaining member.
      transferred,
      // Removed with the account because no other member was left.
      deleted: removed.map(({ id: communityId, name }) => ({ id: communityId, name })),
      r2_cleanup: communityCleanup,
    },
    // Anything the account posted in other members' spaces (chat images, thread
    // attachments, showcase media, event comment images) cascades away with the
    // account but its R2 objects are not enumerated here — the admin orphan
    // audit (Tools → R2 storage health) reclaims them.
  });
}
