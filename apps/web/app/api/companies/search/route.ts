import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { searchCompanies } from "@/lib/companies/service";

/**
 * Company directory search for the "Where do you work?" picker.
 *
 * Read-only and unprivileged: it returns only what a company page shows
 * publicly (name, logo, primary verified domain, verified member count). No
 * member's work email or membership list is reachable through it.
 */
export async function GET(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  const limited = await rateLimit(`company-search:${session.userId}`, 60, 60);
  if (!limited.success) {
    return NextResponse.json(
      { error: "Too many searches. Try again in a moment." },
      { status: 429 }
    );
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const companies = await searchCompanies(createServiceClient(), query);

  return NextResponse.json({ companies });
}
