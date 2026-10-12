import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const MAX_RESULTS = 10;
const MIN_QUERY_CHARS = 2;

/**
 * GET /api/dm/people?q=<query>
 *
 * Member search for the "new message" picker. Every non-blocked member is
 * reachable (that is the point of DMs), so the only filters are the query,
 * the caller themselves and deleted/blocked accounts.
 */
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;

  // LIKE wildcards typed by the user are literal characters, not patterns.
  const query = (req.nextUrl.searchParams.get("q") ?? "")
    .replace(/[\\%_]/g, "")
    .trim();
  if (query.length < MIN_QUERY_CHARS) {
    return NextResponse.json({ people: [] });
  }

  const db = createServiceClient();
  const { data: users, error } = await db
    .from("users")
    .select("id, name")
    .ilike("name", `%${query}%`)
    .eq("is_blocked", false)
    .neq("id", userId)
    .order("name", { ascending: true })
    .limit(MAX_RESULTS);

  if (error) {
    return NextResponse.json({ error: "Failed to search members." }, { status: 500 });
  }

  const ids = ((users ?? []) as Array<{ id: string }>).map((row) => row.id);
  const avatarById = new Map<string, string | null>();
  if (ids.length) {
    const { data: profiles } = await db
      .from("designer_profiles")
      .select("user_id, avatar_url")
      .in("user_id", ids);
    for (const profile of (profiles ?? []) as Array<{ user_id: string; avatar_url: string | null }>) {
      avatarById.set(profile.user_id, profile.avatar_url);
    }
  }

  return NextResponse.json({
    people: ((users ?? []) as Array<{ id: string; name: string }>).map((row) => ({
      id: row.id,
      name: row.name,
      avatar_url: avatarById.get(row.id) ?? null,
    })),
  });
}
