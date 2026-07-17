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
  const search = searchParams.get("search") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = 25;

  const db = createServiceClient();

  let query = db
    .from("users")
    .select(
      `id, name, email, is_blocked, created_at,
       designer_profiles(id, experience_level,
         companies(name), cities(name), design_sectors(name)
       )`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[admin/users] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch users." }, { status: 500 });
  }

  return NextResponse.json({ users: data, total: count ?? 0 });
}
