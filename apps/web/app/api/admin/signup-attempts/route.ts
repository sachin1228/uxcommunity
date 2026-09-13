import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * GET /api/admin/signup-attempts
 *
 * Emails that passed signup step 1 but never produced an account. Rows flip to
 * `status = 'completed'` from /api/signup/avatar, so this only ever returns the
 * drop-offs.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = 25;

  const db = createServiceClient();

  let query = (db.from("signup_attempts") as any)
    .select("id, email, name, flow, application_id, started_at, resume_email_sent_at", { count: "exact" })
    .eq("status", "started")
    .order("started_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[admin/signup-attempts] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch incomplete signups." }, { status: 500 });
  }

  return NextResponse.json({
    attempts: (data ?? []) as Array<Record<string, unknown>>,
    total: count ?? 0,
  });
}
