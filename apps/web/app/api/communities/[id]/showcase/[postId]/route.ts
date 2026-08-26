import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { isPublicContentScope } from "@/lib/content-scope";

const TYPES = new Set(["finished", "wip", "case_study", "feedback"]);
const CATEGORIES = new Set(["ui_ux", "branding", "illustration", "motion", "product", "other"]);

async function getPost(db: ReturnType<typeof createServiceClient>, communityId: string, postId: string) {
  const query = db.from("community_showcase_posts").select("*").eq("id", postId);
  return (isPublicContentScope(communityId) ? query.is("community_id", null).eq("is_public", true) : query.eq("community_id", communityId)).maybeSingle();
}

async function enrich(db: ReturnType<typeof createServiceClient>, row: Record<string, unknown>, userId: string) {
  const postId = row.id as string;
  const authorId = row.user_id as string;
  const [{ data: user }, { data: profile }, { data: likes }, { data: myLike }, { data: mySave }, { count }] = await Promise.all([
    db.from("users").select("name").eq("id", authorId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", authorId).maybeSingle(),
    db.from("showcase_likes").select("post_id").eq("post_id", postId),
    db.from("showcase_likes").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(),
    db.from("showcase_saves").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(),
    db.from("showcase_comments").select("id", { count: "exact", head: true }).eq("post_id", postId),
  ]);
  return { ...row, author: { name: user?.name ?? "Community member", avatar_url: profile?.avatar_url ?? null }, like_count: likes?.length ?? 0, comment_count: count ?? 0, user_liked: Boolean(myLike), user_saved: Boolean(mySave) };
}

async function canInteract(db: ReturnType<typeof createServiceClient>, communityId: string, isPublic: boolean, userId: string) {
  if (isPublicContentScope(communityId) || isPublic) return true;
  // Non-public community posts stay member-only.
  const { data } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const db = createServiceClient(); const userId = session.userId!;
  const { data, error } = await getPost(db, id, postId);
  if (error) return NextResponse.json({ error: "Failed to load showcase post." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (!(await canInteract(db, id, (data as { is_public: boolean }).is_public, userId))) return NextResponse.json({ error: "Not a member." }, { status: 403 });
  return NextResponse.json({ post: await enrich(db, data, userId) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const userId = session.userId!; const db = createServiceClient();
  const { data: post } = await getPost(db, id, postId);
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (!(await canInteract(db, id, (post as { is_public: boolean }).is_public, userId))) return NextResponse.json({ error: "Not a member." }, { status: 403 });
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if ((body.action !== "like" && body.action !== "save") || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "An action and boolean active state are required." }, { status: 422 });
  }
  const table = body.action === "like" ? "showcase_likes" : "showcase_saves";
  const result = body.active
    ? await db.from(table).upsert(
        { post_id: postId, user_id: userId },
        { onConflict: "post_id,user_id", ignoreDuplicates: true },
      )
    : await db.from(table).delete().eq("post_id", postId).eq("user_id", userId);
  if (result.error) return NextResponse.json({ error: "Could not update post." }, { status: 500 });
  const [{ data: persisted, error: stateError }, { count, error: countError }] = await Promise.all([
    db.from(table).select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle(),
    db.from(table).select("post_id", { count: "exact", head: true }).eq("post_id", postId),
  ]);
  if (stateError || countError || Boolean(persisted) !== body.active) {
    return NextResponse.json({ error: "Post state could not be confirmed." }, { status: 500 });
  }
  return NextResponse.json({ active: body.active, count: count ?? 0 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const userId = session.userId!; const db = createServiceClient();
  const { data: existing } = await getPost(db, id, postId);
  if (!existing) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only edit your own showcase posts." }, { status: 403 });
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim() : ""; const description = typeof body.description === "string" ? body.description.trim() : "";
  const imageUrl = typeof body.image_url === "string" ? body.image_url.trim() : ""; const projectUrl = typeof body.project_url === "string" ? body.project_url.trim() || null : null;
  const postType = typeof body.post_type === "string" ? body.post_type : ""; const category = typeof body.category === "string" ? body.category : "";
  const tags = Array.isArray(body.tags) ? [...new Set(body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))] : [];
  const isPublic = body.is_public === true;
  if (!title || title.length > 120 || description.length > 1200 || !imageUrl || imageUrl.length > 2048 || !TYPES.has(postType) || !CATEGORIES.has(category) || tags.length > 5 || tags.some((tag) => tag.length > 30)) return NextResponse.json({ error: "One or more showcase fields are invalid." }, { status: 422 });
  if (projectUrl) { try { const url = new URL(projectUrl); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); } catch { return NextResponse.json({ error: "Project URL must be a valid web address." }, { status: 422 }); } }
  const { data, error } = await db.from("community_showcase_posts").update({ title, description, image_url: imageUrl, project_url: projectUrl, post_type: postType, category, tags, is_public: isPublic }).eq("id", postId).eq("user_id", userId).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Failed to update showcase post." }, { status: 500 });
  return NextResponse.json({ post: await enrich(db, data, userId) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const userId = session.userId!; const db = createServiceClient();
  const { data: existing } = await getPost(db, id, postId);
  if (!existing) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only delete your own showcase posts." }, { status: 403 });
  const { error } = await db.from("community_showcase_posts").delete().eq("id", postId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Failed to delete showcase post." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
