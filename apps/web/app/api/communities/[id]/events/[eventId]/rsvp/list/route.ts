import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadEventForViewer } from "@/lib/communities/event-access";
import { loadEventRsvps } from "@/lib/communities/event-cards";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try { session = await requireSession("user", { allowUnverified: true }); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const db = createServiceClient();
  const access = await loadEventForViewer<{ id: string; is_public: boolean }>(
    db,
    communityId,
    eventId,
    session.userId!,
    "id, is_public",
  );
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? "Event not found." : "Not a member of this community." },
      { status: access.status },
    );
  }

  return NextResponse.json({ rsvps: await loadEventRsvps(eventId) });
}
