import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/design-duel/server-data";

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
  const challengeId = (await params).id;
  const db = createServiceClient();
  const userId = session.userId!;

  const { data: challenge } = await db
    .from("design_duel_challenges")
    .select("id, status, time_limit_seconds")
    .eq("id", challengeId)
    .maybeSingle();

  if (!challenge || challenge.status !== "active") {
    return NextResponse.json({ error: "Challenge not found." }, { status: 404 });
  }

  const { data: existing } = await db
    .from("design_duel_submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.status === "submitted") {
    return NextResponse.json(
      { error: "You have already submitted this challenge." },
      { status: 409 },
    );
  }

  const { data: submission, error } = existing
    ? { data: existing, error: null }
    : await db
        .from("design_duel_submissions")
        .insert({ challenge_id: challengeId, user_id: userId, status: "in_progress" })
        .select("*")
        .single();

  if (error || !submission) {
    return NextResponse.json({ error: "Could not start challenge." }, { status: 500 });
  }

  const deadlineMs = new Date(submission.started_at).getTime() + challenge.time_limit_seconds * 1000;
  return NextResponse.json(
    {
      submission: { ...submission, design_json: undefined },
      deadline: new Date(deadlineMs).toISOString(),
      timeLimitSeconds: challenge.time_limit_seconds,
    },
    { status: 201 },
  );
}