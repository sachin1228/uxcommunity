import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadDmBlock } from "@/lib/direct-messages/server";
import { getProfileCompanyState } from "@/lib/companies/service";
import { isProfileId } from "@/lib/profile/links";
import { resolveProfileRoleLabel } from "@/lib/profile/role-label";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile/[userId]
 *
 * A member's identity card as another member sees it — the JSON half of the
 * web page at /dashboard/profile/[userId], consumed by the mobile member
 * profile (which puts the DM "Message" chip on it). No email, no pending
 * company challenge: those belong to the owner's own profile only.
 *
 * Blocking reshapes the answer the same way it reshapes the page:
 *   • the owner blocked the viewer  → `blockedViewer: true` and nothing else;
 *   • the viewer blocked the owner  → identity still renders, `blockedByMe`
 *     is true, and the screen hides the activity feed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  const { userId } = await params;
  if (!isProfileId(userId)) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const viewerId = session.userId!;
  if (userId === viewerId) {
    return NextResponse.json(
      { error: "This is your own profile." },
      { status: 422 },
    );
  }

  const db = createServiceClient();
  const [{ data: user }, { data: profile }, companyState, blockedViewer, blockedByMe] =
    await Promise.all([
      db.from("users").select("name, created_at").eq("id", userId).maybeSingle(),
      db
        .from("designer_profiles")
        .select(
          "avatar_url, avatar_source, experience_level, job_title, linkedin_url, portfolio_url, bio, cities(id, name), design_sectors(id, name)",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      getProfileCompanyState(db, userId),
      loadDmBlock(db, userId, viewerId),
      loadDmBlock(db, viewerId, userId),
    ]);

  if (!user) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const headers = { "Cache-Control": "no-store" };

  if (blockedViewer) {
    return NextResponse.json({ blockedViewer: true, blockedByMe }, { headers });
  }

  const roleLabel = await resolveProfileRoleLabel(
    db,
    (profile as { job_title?: string | null } | null)?.job_title ?? null,
    (profile as { experience_level?: string | null } | null)?.experience_level ?? null,
  );

  return NextResponse.json(
    {
      user: { id: userId, name: user.name, created_at: user.created_at },
      profile,
      roleLabel,
      company: companyState.company,
      blockedViewer: false,
      blockedByMe,
    },
    { headers },
  );
}
