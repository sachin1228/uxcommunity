import { NextRequest, NextResponse } from "next/server";
import { requireSession, type SessionPayload } from "@/lib/auth/session";
import { recordAdminAudit } from "@/lib/moderation/admin-audit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  deferNotification,
  communityHref,
  managerRemovalNotice,
  reportReviewedNotice,
} from "@/lib/notifications";
import { removeCommunityContent } from "@/lib/communities/content-removal";
import { logCommunityActivity } from "@/lib/communities/manager-role";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/admin/events/[id]
 *
 * Removes one event outright — the moderation lever for fake or spam events.
 * Goes through the same removal service every other event delete uses
 * (removeCommunityContent): the event's group chat is unlinked first and
 * survives with its members and messages, the row is deleted with everything
 * that hung off it (RSVPs, comments, likes, saves) cascading, the cover is
 * reclaimed from R2 when nothing else wears it, and the removal is announced
 * in the realtime rooms that rendered the event so member feeds drop the card
 * without a reload.
 *
 * Without a snapshot, the removal is permanent — the confirm modal on the
 * admin page says so. The host is told their event came down ("An admin
 * deleted your event"), any reports on the event close as removed (their
 * reporters get the usual thank-you), and the community's activity trail
 * records the platform action.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session: SessionPayload;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }
  const adminId = session.userId ?? null;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Unknown event." }, { status: 404 });
  }

  const db = createServiceClient();

  const { data: event, error: loadError } = await db
    .from("community_events")
    .select("id, title, user_id, community_id")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("[admin/events] load error:", loadError);
    return NextResponse.json({ error: "Failed to delete the event." }, { status: 500 });
  }
  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  const communityId = event.community_id;
  const removal = await removeCommunityContent(db, {
    kind: "event",
    id,
    scope: communityId ?? PUBLIC_CONTENT_SCOPE,
  });
  if (!removal.ok) {
    console.error("[admin/events] removal error:", removal.error);
    return NextResponse.json({ error: "Failed to delete the event." }, { status: 500 });
  }

  if (removal.removed) {
    try {
      await recordAdminAudit(db, session, {
        action: "delete_event",
        targetType: "event",
        targetId: id,
        subjectUserId: event.user_id,
        previousState: {
          title: event.title,
          community_id: communityId,
        },
        newState: { deleted: true },
        reason: "admin_delete",
      });
    } catch (auditError) {
      console.error("[admin/events] audit failed:", auditError);
      return NextResponse.json(
        { error: "Event was deleted, but the moderation audit record could not be written." },
        { status: 500 },
      );
    }

    const href = communityId ? communityHref(communityId) : "/dashboard/notifications";

    // The host hears why the event is gone; the notice names the role, never
    // the admin (same voice as every other removal notice).
    deferNotification({
      userId: event.user_id,
      actorId: adminId,
      communityId,
      type: "event_deleted",
      entityType: "event",
      entityId: id,
      title: () => managerRemovalNotice("admin", "event"),
      body: event.title.slice(0, 120),
      href,
    });

    // A takedown answers every open report on the event — the reports queue
    // must not keep asking about something that is already gone.
    const { data: resolvedReports } = await db
      .from("content_reports")
      .update({
        status: "removed",
        resolved_at: new Date().toISOString(),
        resolved_by: adminId,
      })
      .eq("content_type", "event")
      .eq("content_id", id)
      .eq("status", "pending")
      .select("id, reporter_id");

    const reporterIds = [
      ...new Set(
        ((resolvedReports ?? []) as { id: string; reporter_id: string | null }[])
          .map((row) => row.reporter_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    // A reporter whose account was deleted has a retained report but no
    // account left to notify.
    const thanks = reportReviewedNotice("event", true);
    for (const reporterId of reporterIds) {
      deferNotification({
        userId: reporterId,
        actorId: adminId,
        communityId,
        type: "report_reviewed",
        entityType: "event",
        entityId: id,
        title: () => thanks.title,
        body: thanks.body,
        href,
      });
    }

    // Best-effort audit trail so the community's managers see the platform
    // action, mirroring the report-review removal.
    if (communityId) {
      await logCommunityActivity(db, {
        communityId,
        actorId: adminId,
        actorRole: "platform",
        action: "event_deleted",
        targetUserId: event.user_id,
        details: { content_type: "event", content_id: id },
      });
    }
  }

  return NextResponse.json({
    success: true,
    removed: removal.removed,
    chat_community_id: removal.chatCommunityId,
  });
}
