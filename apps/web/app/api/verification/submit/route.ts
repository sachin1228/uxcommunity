import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { parseR2Key } from "@/lib/r2";
import {
  normalizeLinkedInUrl,
  normalizePortfolioLinks,
  normalizeWorkSampleUrls,
} from "@/lib/verification/rules";

/**
 * POST /api/verification/submit
 *
 * Validates the required steps and opens a review request. The member becomes
 * `pending` immediately; the admin decision moves them to `approved` or
 * `rejected` (with a one-month reapply clock).
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;
  const rl = await rateLimit(`verification:submit:${userId}`, 5, 3600);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const linkedinUrl = normalizeLinkedInUrl(body.linkedin_url);
  if (!linkedinUrl) {
    const message =
      typeof body.linkedin_url === "string" && body.linkedin_url.trim()
        ? "Enter a valid LinkedIn profile URL."
        : "Your LinkedIn profile is required.";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const portfolio = normalizePortfolioLinks(body.portfolio_links);
  if (portfolio.error) {
    return NextResponse.json({ error: portfolio.error }, { status: 422 });
  }

  const samples = normalizeWorkSampleUrls(body.work_sample_urls);
  if (samples.error) {
    return NextResponse.json({ error: samples.error }, { status: 422 });
  }
  for (const url of samples.urls) {
    const key = parseR2Key(url);
    if (!key || !key.startsWith(`verification/${userId}/`)) {
      return NextResponse.json(
        { error: "Work samples must be uploaded through the verification form." },
        { status: 422 },
      );
    }
  }

  const db = createServiceClient();
  const { data: user } = await db
    .from("users")
    .select("verification_status, verification_reapply_at, email_verified_at")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  const row = user as {
    verification_status: string;
    verification_reapply_at: string | null;
    email_verified_at: string | null;
  };

  if (row.verification_status === "approved") {
    return NextResponse.json({ error: "Your account is already verified." }, { status: 409 });
  }
  if (row.verification_status === "pending") {
    return NextResponse.json({ error: "Your verification is already under review." }, { status: 409 });
  }
  if (
    row.verification_status === "rejected" &&
    row.verification_reapply_at &&
    new Date(row.verification_reapply_at) > new Date()
  ) {
    return NextResponse.json(
      {
        error: "You can reapply after your one-month window opens.",
        reapplyAt: row.verification_reapply_at,
      },
      { status: 403 },
    );
  }
  if (!row.email_verified_at) {
    return NextResponse.json(
      { error: "Verify your account email before submitting.", code: "email_unverified" },
      { status: 422 },
    );
  }

  const { data: inserted, error: insertError } = await (db
    .from("account_verification_requests") as any)
    .insert({
      user_id: userId,
      linkedin_url: linkedinUrl,
      portfolio_links: portfolio.links,
      work_sample_urls: samples.urls,
      email_verified_at: row.email_verified_at,
      status: "pending",
    })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return NextResponse.json(
        { error: "Your verification is already under review." },
        { status: 409 },
      );
    }
    console.error("[verification/submit] insert error:", insertError);
    return NextResponse.json({ error: "Could not submit your verification." }, { status: 500 });
  }

  const { error: updateError } = await db
    .from("users")
    .update({
      verification_status: "pending",
      verification_rejection_reason: null,
      verification_reapply_at: null,
      verification_reviewed_at: null,
      verification_notified_at: null,
    })
    .eq("id", userId);

  if (updateError) {
    console.error("[verification/submit] user update error:", updateError);
    // Roll the request back so the member is not left with an invisible review.
    await (db.from("account_verification_requests") as any)
      .delete()
      .eq("id", (inserted as { id: string }).id);
    return NextResponse.json({ error: "Could not submit your verification." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    status: "pending",
    requestId: (inserted as { id: string }).id,
    submittedAt: (inserted as { created_at: string }).created_at,
  });
}
