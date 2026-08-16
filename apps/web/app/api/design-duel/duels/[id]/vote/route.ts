import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient, getDuelView } from "@/lib/design-duel/server-data";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }
  const duelId = (await params).id;
  const db = createServiceClient();
  const userId = session.userId!;

  let body: { selected_submission_id?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const selected = typeof body.selected_submission_id === "string" ? body.selected_submission_id : "";
  if (!selected) {
    return NextResponse.json({ error: "Pick a design to vote for." }, { status: 422 });
  }
  const reason =
    typeof body.reason === "string" &&
    ["hierarchy", "clarity", "visual", "accessibility", "interaction"].includes(body.reason)
      ? body.reason
      : null;

  const { data, error } = await callPerformanceRpc(db, "cast_vote", {
    p_duel_id: duelId,
    p_voter_id: userId,
    p_selected_submission_id: selected,
    p_reason: reason,
  });

  if (error) {
    console.error("[design duel vote]", error);
    return NextResponse.json({ error: "Could not record your vote." }, { status: 500 });
  }

  const result = (data ?? null) as Record<string, unknown> | null;

  if (result?.status === "participant") {
    return NextResponse.json({ error: "You can't vote in your own duel." }, { status: 403 });
  }
  if (result?.status === "already_voted") {
    return NextResponse.json({ error: "You've already voted in this duel." }, { status: 409 });
  }
  if (result?.status === "closed") {
    return NextResponse.json({ error: "This duel has ended." }, { status: 409 });
  }
  if (result?.status !== "voted") {
    return NextResponse.json({ error: "Could not record your vote." }, { status: 500 });
  }

  const view = await getDuelView(db, duelId, userId);
  return NextResponse.json({ result, duel: view });
}