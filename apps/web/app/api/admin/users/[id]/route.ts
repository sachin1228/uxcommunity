import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession, type SessionPayload } from "@/lib/auth/session";
import { recordAdminAudit } from "@/lib/moderation/admin-audit";
import { setUserBlocked } from "@/lib/auth/session-registry";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { logEvent } from "@/lib/observability/log";
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
  let session: SessionPayload;
  try {
    session = await requireSession("admin");
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
  const { data: before } = (await (db as unknown as SupabaseClient)
    .from("users")
    .select("id, is_blocked, suspended_until")
    .eq("id", id)
    .maybeSingle()) as {
    data: { id: string; is_blocked: boolean; suspended_until: string | null } | null;
  };

  try {
    // One transaction flips the flag, bumps session_version and revokes every
    // registry row. Unblocking bumps the version again, so the member must sign
    // in fresh rather than resuming a pre-suspension session.
    await setUserBlocked(id, is_blocked, is_blocked ? "admin_block" : "admin_unblock");
  } catch (error) {
    console.error("[admin/users] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update user." }, { status: 500 });
  }

  if (is_blocked) {
    try {
      await revokeRealtimeSessions({ userId: id, all: true });
    } catch (error) {
      logEvent("warn", {
        event: "admin.user_blocked.realtime_failed",
        userId: id,
        error,
      });
    }
  }

  await recordAdminAudit(db, session, {
    action: is_blocked ? "ban_user" : "unban_user",
    targetType: "user",
    targetId: id,
    subjectUserId: id,
    previousState: {
      is_blocked: before?.is_blocked ?? null,
      suspended_until: before?.suspended_until ?? null,
    },
    newState: { is_blocked, suspended_until: is_blocked ? before?.suspended_until ?? null : null },
    reason: is_blocked ? "admin_block" : "admin_unblock",
  });

  const { data, error } = await db
    .from("users")
    .select("id, name, email, is_blocked")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[admin/users] PATCH readback error:", error);
    return NextResponse.json({ error: "Failed to update user." }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session: SessionPayload;
  try {
    session = await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const db = createServiceClient();
  const { data: before } = (await (db as unknown as SupabaseClient)
    .from("users")
    .select("id, is_blocked, suspended_until")
    .eq("id", id)
    .maybeSingle()) as {
    data: { id: string; is_blocked: boolean; suspended_until: string | null } | null;
  };

  try {
    const summary = await deleteAccountCascade(db, id);

    try {
      await revokeRealtimeSessions({ userId: id, all: true });
    } catch (error) {
      logEvent("warn", {
        event: "admin.user_deleted.realtime_failed",
        userId: id,
        error,
      });
    }

    try {
      await recordAdminAudit(db, session, {
        action: "delete_user",
        targetType: "user",
        targetId: id,
        subjectUserId: id,
        previousState: {
          is_blocked: before?.is_blocked ?? null,
          suspended_until: before?.suspended_until ?? null,
        },
        newState: { deleted: true },
        reason: "admin_delete",
      });
    } catch (auditError) {
      console.error("[admin/users] delete audit failed:", auditError);
      return NextResponse.json(
        { error: "Account was deleted, but the moderation audit record could not be written." },
        { status: 500 },
      );
    }

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
