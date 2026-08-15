import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";

const TYPES = new Set(["finished", "wip", "case_study", "feedback"]);
const CATEGORIES = new Set(["ui_ux", "branding", "illustration", "motion", "product", "other"]);

export async function POST(request: NextRequest) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }

  const userId = session.userId!;
  const db = createServiceClient();
  const limit = await rateLimit(`home-showcase:create:${userId}:60s`, 5, 60);
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

  const { data, error } = await db.from("community_showcase_posts").insert({ community_id: null, user_id: userId, title, description, image_url: imageUrl, project_url: projectUrl, post_type: postType, category, tags, is_public: true }).select("*").single();
  if (error || !data) { console.error("[POST home showcase]", error); return NextResponse.json({ error: "Failed to share your work." }, { status: 500 }); }

  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);
  return NextResponse.json({
    post: {
      ...data,
      author: { name: user?.name ?? "Community member", avatar_url: profile?.avatar_url ?? null },
      like_count: 0,
      comment_count: 0,
      user_liked: false,
      user_saved: false,
    },
  }, { status: 201 });
}