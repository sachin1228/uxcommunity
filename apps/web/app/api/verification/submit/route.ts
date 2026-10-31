import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { isOwnVerificationKey } from "@/lib/r2-private";
import {
  normalizeLinkedInUrl,
  normalizePortfolioLinks,
  normalizeWorkSampleKeys,
  VERIFICATION_SAMPLES_MAX,
} from "@/lib/verification/rules";
import {
  parseVerificationSamplePath,
  verificationSampleKey,
} from "@/lib/verification/samples";

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

  const sampleKeys = normalizeWorkSampleKeys(body.work_sample_keys);
  if (sampleKeys.error) {
    return NextResponse.json({ error: sampleKeys.error }, { status: 422 });
  }

  // New submissions must use the private upload flow. Legacy public URLs are
  // still readable on old requests, but acceptance here would recreate the
  // public-PII path the private bucket was introduced to close.
  if (Array.isArray(body.work_sample_urls) && body.work_sample_urls.length > 0) {
    return NextResponse.json(
      { error: "Work samples must be uploaded through the verification form." },
      { status: 422 },
    );
  }
  const rawRefs = Array.isArray(body.work_sample_refs) ? body.work_sample_refs : [];
  const sampleRefs = rawRefs.filter((value): value is string => typeof value === "string");
  if (sampleRefs.length !== rawRefs.length || sampleRefs.length > VERIFICATION_SAMPLES_MAX) {
    return NextResponse.json(
      { error: `Upload at most ${VERIFICATION_SAMPLES_MAX} work samples.` },
      { status: 422 },
    );
  }
  const parsedRefs = sampleRefs.map(parseVerificationSamplePath);
  if (parsedRefs.some((value) => value === null)) {
    return NextResponse.json(
      { error: "Work samples must be uploaded through the verification form." },
      { status: 422 },
    );
  }
  if (sampleKeys.keys.length > VERIFICATION_SAMPLES_MAX) {
    return NextResponse.json(
      { error: `Upload at most ${VERIFICATION_SAMPLES_MAX} work samples.` },
      { status: 422 },
    );
  }
  for (const key of sampleKeys.keys) {
    if (!isOwnVerificationKey(key, userId)) {
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

  // Existing key-backed samples are referenced by proxy path. Resolve them
  // server-side so the browser/phone never receives a raw private key. Legacy
  // URL-only samples cannot be carried into a new submission; the member must
  // re-upload them through the private form.
  const referencedKeys: string[] = [];
  const requestCache = new Map<string, {
    user_id: string;
    work_sample_keys: string[] | null;
  } | null>();
  for (const ref of parsedRefs) {
    if (!ref) continue;
    let request = requestCache.get(ref.requestId);
    if (request === undefined) {
      const { data: found } = (await (db as any)
        .from("account_verification_requests")
        .select("user_id, work_sample_keys")
        .eq("id", ref.requestId)
        .maybeSingle()) as {
        data: { user_id: string; work_sample_keys: string[] | null } | null;
      };
      request = found;
      requestCache.set(ref.requestId, request);
    }
    if (!request || request.user_id !== userId) {
      return NextResponse.json(
        { error: "Work samples must be uploaded through the verification form." },
        { status: 422 },
      );
    }
    const key = verificationSampleKey(
      { work_sample_keys: request.work_sample_keys, work_sample_urls: [] },
      ref.index,
    );
    if (!key) {
      return NextResponse.json(
        { error: "Legacy work samples must be re-uploaded through this form." },
        { status: 422 },
      );
    }
    if (!isOwnVerificationKey(key, userId)) {
      return NextResponse.json(
        { error: "Work samples must be uploaded through the verification form." },
        { status: 422 },
      );
    }
    referencedKeys.push(key);
  }

  const allSampleKeys = [...new Set([...sampleKeys.keys, ...referencedKeys])];
  if (allSampleKeys.length > VERIFICATION_SAMPLES_MAX) {
    return NextResponse.json(
      { error: `Upload at most ${VERIFICATION_SAMPLES_MAX} work samples.` },
      { status: 422 },
    );
  }

  const { data: inserted, error: insertError } = await (db
    .from("account_verification_requests") as any)
    .insert({
      user_id: userId,
      linkedin_url: linkedinUrl,
      portfolio_links: portfolio.links,
      work_sample_keys: allSampleKeys,
      work_sample_urls: [],
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
