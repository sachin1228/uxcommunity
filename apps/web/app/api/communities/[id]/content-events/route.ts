import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityReadModel } from "@/lib/communities/read-models";
import {
  contentAreaLimits,
  loadCommunityContentEvents,
} from "@/lib/communities/content-events";

/**
 * GET /api/communities/[id]/content-events
 *
 * The first page of the community's threads / showcase posts / resources /
 * events with author info, reactions, RSVP and comment counts — exactly the
 * data the chat timeline's permanent "created a …" cards render (the same
 * section /bootstrap bundles for the web client). The mobile chat reads it
 * directly on open and re-reads it after reconnects, since it has no
 * bootstrap request to piggyback on.
 *
 * Member-only, like every other read of the community.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }
  const { id: communityId } = await params;

  const readModel = await loadCommunityReadModel(communityId, session.userId!);
  if (!readModel.ok) {
    return NextResponse.json({ error: readModel.error }, { status: readModel.status });
  }

  const events = await loadCommunityContentEvents(
    communityId,
    contentAreaLimits(readModel.data.community as Record<string, unknown>),
  );
  return NextResponse.json({ events });
}
