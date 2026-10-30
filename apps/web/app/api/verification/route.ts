import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  privateWorkSampleKeys,
  verificationSampleDisplayUrls,
} from "@/lib/verification/samples";

/**
 * GET /api/verification
 *
 * Everything the verification page and the read-only banner need: the member's
 * current state, the rejection reason/reapply date, the account email and its
 * verified flag, and the latest submission.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  const [{ data: user, error: userError }, { data: latest }] = await Promise.all([
    db
      .from("users")
      .select(
        "name, email, verification_status, verification_rejection_reason, verification_reapply_at, verification_reviewed_at, email_verified_at",
      )
      .eq("id", session.userId!)
      .maybeSingle(),
    db
      .from("account_verification_requests")
      .select(
        "id, status, linkedin_url, portfolio_links, work_sample_urls, work_sample_keys, rejection_reason, reviewed_at, created_at",
      )
      .eq("user_id", session.userId!)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (userError || !user) {
    return NextResponse.json({ error: "Failed to load verification status." }, { status: 500 });
  }

  const row = user as {
    name: string | null;
    email: string;
    verification_status: string;
    verification_rejection_reason: string | null;
    verification_reapply_at: string | null;
    verification_reviewed_at: string | null;
    email_verified_at: string | null;
  };
  const application = latest as {
    id: string;
    status: string;
    linkedin_url: string;
    portfolio_links: string[] | null;
    work_sample_urls: string[] | null;
    work_sample_keys: string[] | null;
    rejection_reason: string | null;
    reviewed_at: string | null;
    created_at: string;
  } | null;

  const latestSamples = application
    ? {
        keys: privateWorkSampleKeys(application),
        urls: await verificationSampleDisplayUrls(application),
      }
    : null;

  return NextResponse.json({
    status: row.verification_status,
    name: row.name ?? "",
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    reapplyAt: row.verification_reapply_at,
    rejectionReason: row.verification_rejection_reason,
    reviewedAt: row.verification_reviewed_at,
    latest: application
      ? {
          id: application.id,
          status: application.status,
          linkedinUrl: application.linkedin_url,
          portfolioLinks: application.portfolio_links ?? [],
          workSampleUrls: latestSamples?.urls ?? [],
          workSampleKeys: latestSamples?.keys ?? [],
          rejectionReason: application.rejection_reason,
          reviewedAt: application.reviewed_at,
          createdAt: application.created_at,
        }
      : null,
  });
}
