import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient, listChallenges } from "@/lib/design-duel/server-data";

export const dynamic = "force-dynamic";

export async function GET() {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }
  const db = createServiceClient();
  const challenges = await listChallenges(db, session.userId ?? null);
  return NextResponse.json({ challenges });
}