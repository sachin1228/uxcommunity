import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/design-duel/server-data";
import { sanitizeDesign } from "@/lib/design-duel/design";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";

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

  let body: { submission_id?: string; design_json?: unknown; preview_image?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const submissionId = typeof body.submission_id === "string" ? body.submission_id : "";
  const design = sanitizeDesign(body.design_json);
  if (!design) {
    return NextResponse.json({ error: "Your design is empty. Add a few elements first." }, { status: 422 });
  }
  const previewImage =
    typeof body.preview_image === "string" && body.preview_image.length > 0
      ? body.preview_image.slice(0, 2048)
      : null;
  if (previewImage && !/^https?:\/\//.test(previewImage)) {
    return NextResponse.json({ error: "Invalid preview image." }, { status: 422 });
  }

  const { data: submission } = await db
    .from("design_duel_submissions")
    .select("id, challenge_id, user_id, status")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission || submission.challenge_id !== challengeId || submission.user_id !== userId) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }
  if (submission.status === "submitted") {
    return NextResponse.json({ error: "Already submitted." }, { status: 409 });
  }

  const { data, error } = await callPerformanceRpc(db, "submit_design", {
    p_submission_id: submissionId,
    p_design_json: JSON.parse(JSON.stringify(design)) as unknown as Json,
    p_preview_image: previewImage,
  });

  if (error) {
    console.error("[design duel submit]", error);
    return NextResponse.json({ error: "Could not submit your design." }, { status: 500 });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result?.status === "submitted") {
    return NextResponse.json(result, { status: 201 });
  }
  if (result?.status === "already_submitted") {
    return NextResponse.json({ error: "Already submitted." }, { status: 409 });
  }
  return NextResponse.json({ error: "Could not submit your design." }, { status: 500 });
}