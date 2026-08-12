import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const TYPES = new Set(["finished", "wip", "case_study", "feedback"]);
const CATEGORIES = new Set(["ui_ux", "branding", "illustration", "motion", "product", "other"]);

async function member(db: ReturnType<typeof createServiceClient>, communityId: string, userId: string) {
  const { data } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

async function enrich(db: ReturnType<typeof createServiceClient>, rows: Record<string, unknown>[], userId: string) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id as string);
  const users = [...new Set(rows.map((row) => row.user_id as string))];
  const [{ data: names }, { data: profiles }, { data: likes }, { data: saves }, { data: comments }] = await Promise.all([
    db.from("users").select("id, name").in("id", users),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", users),
    db.from("showcase_likes").select("post_id, user_id").in("post_id", ids),
    db.from("showcase_saves").select("post_id, user_id").in("post_id", ids),
    db.from("showcase_comments").select("post_id").in("post_id", ids),
  ]);
  const nameMap = Object.fromEntries((names ?? []).map((item) => [item.id, item.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((item) => [item.user_id, item.avatar_url]));
  return rows.map((row) => {
    const postLikes = (likes ?? []).filter((item) => item.post_id === row.id);
    const postSaves = (saves ?? []).filter((item) => item.post_id === row.id);
    return {
      ...row,
      author: { name: nameMap[row.user_id as string] ?? "Community member", avatar_url: avatarMap[row.user_id as string] ?? null },
      like_count: postLikes.length,
      comment_count: (comments ?? []).filter((item) => item.post_id === row.id).length,
      user_liked: postLikes.some((item) => item.user_id === userId),
      user_saved: postSaves.some((item) => item.user_id === userId),
    };
  });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id } = await params;
  const db = createServiceClient();
  if (!(await member(db, id, session.userId!))) return NextResponse.json({ error: "Not a member." }, { status: 403 });
  const { data, error } = await db.from("community_showcase_posts").select("*").eq("community_id", id).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Failed to load showcase posts." }, { status: 500 });
  return NextResponse.json({ posts: await enrich(db, (data ?? []) as Record<string, unknown>[], session.userId!) });
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
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const imageUrl = typeof body.image_url === "string" ? body.image_url.trim() : "";
  const projectUrl = typeof body.project_url === "string" ? body.project_url.trim() || null : null;
  const postType = typeof body.post_type === "string" ? body.post_type : "";
  const category = typeof body.category === "string" ? body.category : "";
  const tags = Array.isArray(body.tags) ? [...new Set(body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))] : [];
  if (!title || title.length > 120 || description.length > 1200 || !imageUrl || imageUrl.length > 2048) return NextResponse.json({ error: "Check the title, description, and preview image." }, { status: 422 });
  if (!TYPES.has(postType) || !CATEGORIES.has(category) || tags.length > 5 || tags.some((tag) => tag.length > 30)) return NextResponse.json({ error: "Invalid type, category, or tags." }, { status: 422 });
  if (projectUrl) { try { const url = new URL(projectUrl); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); } catch { return NextResponse.json({ error: "Project URL must be a valid web address." }, { status: 422 }); } }
  const { data, error } = await db.from("community_showcase_posts").insert({ community_id: id, user_id: userId, title, description, image_url: imageUrl, project_url: projectUrl, post_type: postType, category, tags }).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Failed to share your work." }, { status: 500 });
  return NextResponse.json({ post: (await enrich(db, [data], userId))[0] }, { status: 201 });
}
