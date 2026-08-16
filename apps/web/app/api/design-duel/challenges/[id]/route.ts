import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient, getMyDuels } from "@/lib/design-duel/server-data";
import { sanitizeDesign } from "@/lib/design-duel/design";

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
  const challengeId = (await params).id;
  const db = createServiceClient();
  const userId = session.userId!;

  const [{ data: challenge }, { data: submission }] = await Promise.all([
    db.from("design_duel_challenges").select("*").eq("id", challengeId).maybeSingle(),
    db.from("design_duel_submissions")
      .select("*")
      .eq("challenge_id", challengeId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }

  const myDuels = submission?.status === "submitted" ? await getMyDuels(db, userId) : [];
  const myDuel = myDuels.find((d) => d.challenge_id === challengeId) ?? null;

  return NextResponse.json({
    challenge: {
      ...challenge,
      starting_design: sanitizeDesign(challenge.starting_design),
    },
    submission: submission
      ? {
          ...submission,
          design_json: sanitizeDesign(submission.design_json),
        }
      : null,
    myDuel,
  });
}