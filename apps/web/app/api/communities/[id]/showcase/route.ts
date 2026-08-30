import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { loadCommunityShowcasePage } from "@/lib/communities/read-models";

const CATEGORIES = new Set(["ui_ux", "branding", "illustration", "motion", "product", "other"]);

async function member(db: ReturnType<typeof createServiceClient>, communityId: string, userId: string) {
  const { data } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

async function enrich(db: ReturnType<typeof createServiceClient>, rows: Record<string, unknown>[], userId: string) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id as string);
  const users = [...new Set(rows.map((row) => row.user_id as string))];
  const [{ data: names }, { data: profiles }, { data: interactions, error: interactionsError }] = await Promise.all([
    db.from("users").select("id, name").in("id", users),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", users),
    callPerformanceRpc(db, "get_showcase_interactions", { p_user_id: userId, p_post_ids: ids }),
  ]);
  if (interactionsError) throw interactionsError;

  const nameMap = Object.fromEntries((names ?? []).map((item) => [item.id, item.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((item) => [item.user_id, item.avatar_url]));
  const interactionMap = (interactions ?? {}) as Record<string, {
    like_count?: number;
    comment_count?: number;
    user_liked?: boolean;
    user_saved?: boolean;
  }>;

  return rows.map((row) => {
    const interaction = interactionMap[row.id as string] ?? {};
    return {
      ...row,
      author: { name: nameMap[row.user_id as string] ?? "Community member", avatar_url: avatarMap[row.user_id as string] ?? null },
      like_count: interaction.like_count ?? 0,
      comment_count: interaction.comment_count ?? 0,
      user_liked: interaction.user_liked ?? false,
      user_saved: interaction.user_saved ?? false,
    };
  });
}

const SHOWCASE_PAGE_SIZE = 25;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user", { verifyActive: false }); } catch (error) { return error as Response; }
  const { id } = await params;
  const result = await loadCommunityShowcasePage(id, session.userId!, request.nextUrl.searchParams.get("cursor"));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  if (!(await member(db, id, userId))) return NextResponse.json({ error: "Not a member." }, { status: 403 });
  const limit = await rateLimit(`showcase:create:${userId}:60s`, 5, 60);
  if (!limit.success) return NextResponse.json({ error: "Too many posts. Try again shortly." }, { status: 429 });
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const imageUrl = typeof body.image_url === "string" ? body.image_url.trim() : "";
  const category = typeof body.category === "string" ? body.category : "";
  const isPublic = body.is_public === true;
  const allowReplies = body.allow_replies !== false;
  if (!title || title.length > 120 || !imageUrl || imageUrl.length > 2048) return NextResponse.json({ error: "Check the title and preview image." }, { status: 422 });
  if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Invalid category." }, { status: 422 });
  const { data, error } = await db.from("community_showcase_posts").insert({ community_id: id, user_id: userId, title, image_url: imageUrl, category, is_public: isPublic, allow_replies: allowReplies }).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Failed to share your work." }, { status: 500 });
  return NextResponse.json({ post: (await enrich(db, [data], userId))[0] }, { status: 201 });
}
