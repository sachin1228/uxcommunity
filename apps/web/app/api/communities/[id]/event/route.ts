import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isCommunityMember } from "@/lib/communities/membership";
import { loadEventRoomSection } from "@/lib/communities/event-chat";

/**
 * The event behind a community, for the info card that sits beside its chat.
 *
 * A group chat knows its event only through communities.event_id, which the
 * client deliberately never sees — so the link is resolved here and the card
 * asks this one endpoint (see EventRoomSection). Membership of the room is the
 * same door as the chat itself: whoever may not read the room may not read the
 * people going to it either.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }

  const { id } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  if (!(await isCommunityMember(id, userId))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const section = await loadEventRoomSection(db, id, userId);
  if (!section) {
    return NextResponse.json({ error: "This community is not an event's chat." }, { status: 404 });
  }

  return NextResponse.json(section);
}
