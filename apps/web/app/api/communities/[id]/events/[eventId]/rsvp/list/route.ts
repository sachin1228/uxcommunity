import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { loadEventRsvps } from "@/lib/communities/event-cards";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try { await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }

  const { eventId } = await params;
  return NextResponse.json({ rsvps: await loadEventRsvps(eventId) });
}
