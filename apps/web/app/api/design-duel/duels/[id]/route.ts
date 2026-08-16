import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient, getDuelView } from "@/lib/design-duel/server-data";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }
  const duelId = (await params).id;
  const db = createServiceClient();
  const userId = session.userId!;

  const { data: duel } = await db
    .from("design_duels")
    .select("id, status")
    .eq("id", duelId)
    .maybeSingle();

  if (!duel) {
    return NextResponse.json({ error: "Duel not found." }, { status: 404 });
  }

  if (duel.status === "open") {
    try {
      await callPerformanceRpc(db, "resolve_duel", { p_duel_id: duelId });
    } catch (error) {
      console.error("[design duel resolve]", error);
    }
  }

  const view = await getDuelView(db, duelId, userId);
  if (!view) {
    return NextResponse.json({ error: "Duel not found." }, { status: 404 });
  }
  return NextResponse.json({ duel: view });
}