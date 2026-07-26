import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId } = await params;
  const db = createServiceClient();

  // Start of today in UTC
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count: posts_today } = await db
    .from("community_messages")
    .select("*", { count: "exact", head: true })
    .eq("community_id", communityId)
    .is("deleted_at", null)
    .gte("created_at", todayStart.toISOString());

  return NextResponse.json({ posts_today: posts_today ?? 0 });
}
