import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityStats } from "@/lib/communities/read-models";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try { await requireSession("user", { verifyActive: false }); } catch (error) { return error as Response; }
  const { id: communityId } = await params;
  const result = await loadCommunityStats(communityId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
