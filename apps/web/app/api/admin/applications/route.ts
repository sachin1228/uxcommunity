import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status"); // pending | approved | rejected | all
  const search = searchParams.get("search") ?? "";
  const tagId = searchParams.get("tag");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = 25;

  const db = createServiceClient();

  let query = db
    .from("applications")
    .select(
      `
      id, name, email, linkedin_url, portfolio_url, status,
      review_notes, created_at, updated_at,
      application_tags(tag_id, tags(id, name))
      `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.or(
      `name.ilike.%${search}%,email.ilike.%${search}%`
    );
  }

  if (dateFrom) {
    query = query.gte("created_at", dateFrom);
  }
  if (dateTo) {
    query = query.lte("created_at", dateTo + "T23:59:59Z");
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[admin/applications] query error:", error);
    return NextResponse.json({ error: "Failed to fetch applications" }, { status: 500 });
  }

  // Filter by tag in JS if tagId provided (Supabase doesn't easily support join filters)
  let filtered = data ?? [];
  if (tagId) {
    filtered = filtered.filter((a) =>
      // @ts-ignore
      (a.application_tags ?? []).some((at: { tag_id: string }) => at.tag_id === tagId)
    );
  }

  return NextResponse.json({
    applications: filtered,
    total: count ?? 0,
    page,
    pageSize,
  });
}
