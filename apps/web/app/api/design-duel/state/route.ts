import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/design-duel/server-data";
import { getMyStats, getOpenDuelsToVote, getMyDuels } from "@/lib/design-duel/server-data";

export const dynamic = "force-dynamic";

export async function GET() {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }
  const db = createServiceClient();
  const userId = session.userId!;

  const [stats, openDuels, myDuels] = await Promise.all([
    getMyStats(db, userId),
    getOpenDuelsToVote(db, userId),
    getMyDuels(db, userId),
  ]);

  return NextResponse.json({ stats, openDuels, myDuels });
}