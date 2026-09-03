import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { autoJoinCommunities } from "@/lib/communities/auto-join";

export async function POST() {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  try {
    const joined = await autoJoinCommunities(userId);
    return NextResponse.json({ joined });
  } catch (error) {
    console.error("[auto-join] failed:", error);
    return NextResponse.json({ error: "Failed to auto-join communities." }, { status: 500 });
  }
}
