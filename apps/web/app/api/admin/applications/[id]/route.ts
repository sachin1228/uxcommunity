import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { updateApplicationSchema } from "@/lib/validations";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const db = createServiceClient();

  // Fetch the application
  const { data: application, error } = await db
    .from("applications")
    .select(
      `
      id, name, email, linkedin_url, portfolio_url, status,
      review_notes, applicant_email, created_at, updated_at,
      application_tags(tag_id, tags(id, name))
      `
    )
    .eq("id", id)
    .single();

  if (error || !application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Fetch full history (all applications by same person)
  const { data: history } = await db
    .from("applications")
    .select("id, status, linkedin_url, portfolio_url, review_notes, created_at")
    .eq("applicant_email", application.applicant_email)
    .neq("id", id)
    .order("created_at", { ascending: false });

  // Fetch invitation token if application is approved
  let inviteToken: string | null = null;
  if (application.status === "approved") {
    const { data: invitation } = await db
      .from("invitations")
      .select("token")
      .eq("application_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    inviteToken = invitation?.token ?? null;
  }

  return NextResponse.json({ application, history: history ?? [], inviteToken });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = updateApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { review_notes, tag_ids } = parsed.data;
  const db = createServiceClient();

  // Update review notes
  if (review_notes !== undefined) {
    const { error } = await db
      .from("applications")
      .update({ review_notes })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Failed to update notes" }, { status: 500 });
    }
  }

  // Replace tags
  if (tag_ids !== undefined) {
    await db.from("application_tags").delete().eq("application_id", id);

    if (tag_ids.length > 0) {
      await db.from("application_tags").insert(
        tag_ids.map((tag_id) => ({ application_id: id, tag_id }))
      );
    }
  }

  return NextResponse.json({ success: true });
}
