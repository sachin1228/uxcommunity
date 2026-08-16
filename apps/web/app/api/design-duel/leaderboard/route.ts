import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient, getLeaderboard } from "@/lib/design-duel/server-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }
  const period = request.nextUrl.searchParams.get("period") === "all" ? "all" : "weekly";
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 500);
  const db = createServiceClient();
  const leaderboard = await getLeaderboard(db, session.userId!, period, limit);
  return NextResponse.json({ ...leaderboard, period });
}