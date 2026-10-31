import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  verificationSamplePaths,
  type VerificationSampleRow,
} from "@/lib/verification/samples";

const PAGE_SIZE = 25;

/** GET /api/admin/verifications?status=pending|approved|rejected|all&page=1 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? "pending";
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  let query = (db.from("account_verification_requests") as any).select(
    `id, user_id, linkedin_url, portfolio_links, work_sample_urls, work_sample_keys, email_verified_at,
     status, rejection_reason, reviewed_by, reviewed_at, created_at,
     users!inner(name, email)`,
    { count: "exact" },
  );

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error) {
    console.error("[admin/verifications] GET error:", error);
    return NextResponse.json({ error: "Failed to load verification requests." }, { status: 500 });
  }

  const requests = await Promise.all(
    ((data ?? []) as Array<VerificationSampleRow & Record<string, unknown>>).map(async (row) => {
      const requestId = typeof row.id === "string" ? row.id : "";
      return {
        ...row,
        // Authorization-gated proxy paths only; keys and legacy URLs stay
        // server-side. The proxy re-signs on every image request.
        work_sample_urls: requestId ? verificationSamplePaths(requestId, row) : [],
        work_sample_keys: undefined,
      };
    }),
  );

  return NextResponse.json({
    requests,
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  });
}
