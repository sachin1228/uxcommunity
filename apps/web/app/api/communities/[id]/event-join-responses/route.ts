import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role";
import { loadEventJoinResponses } from "@/lib/communities/event-join-responses";

/**
 * GET /api/communities/[id]/event-join-responses
 *
 * Every member's recorded answers to the event's compulsory join questions.
 * Hosts only: the owner, or an admin granted "manage members" — the same rule
 * the members tab's management actions follow. A community that is not an
 * event's group chat answers with an empty list rather than an error, so the
 * tab can skip the section outright.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  // Verify caller is a manager with member-management rights
  const managerStatus = await loadCommunityManagerStatus(db, communityId, userId);
  if (!managerStatus) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  const canSeeResponses =
    managerStatus.isOwner ||
    (managerStatus.role === "admin" && managerStatus.permissions.can_manage_members);
  if (!canSeeResponses) {
    return NextResponse.json({ error: "Owner or community admin only." }, { status: 403 });
  }

  const responses = await loadEventJoinResponses(db, communityId);
  return NextResponse.json({
    responses: [...responses.values()].map((row) => ({
      user_id: row.user_id,
      company_name: row.company_name,
      work_experience: row.work_experience,
      why_attend: row.why_attend,
      expectations: row.expectations,
      created_at: row.created_at,
    })),
  });
}
