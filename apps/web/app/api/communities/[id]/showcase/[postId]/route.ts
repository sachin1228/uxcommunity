import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const [{ data: membership }, { data: post }] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", userId).maybeSingle(),
    db.from("community_showcase_posts").select("id").eq("id", postId).eq("community_id", id).maybeSingle(),
  ]);
  if (!membership || !post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const action = body.action;
  if (action === "like" || action === "save") {
    const table = action === "like" ? "showcase_likes" : "showcase_saves";
    const { data: existing } = await db.from(table).select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle();
    const result = existing ? await db.from(table).delete().eq("post_id", postId).eq("user_id", userId) : await db.from(table).insert({ post_id: postId, user_id: userId });
    if (result.error) return NextResponse.json({ error: "Could not update post." }, { status: 500 });
    return NextResponse.json({ active: !existing });
  }
  if (action === "comment") {
    const limit = await rateLimit(`showcase:comment:${userId}:60s`, 15, 60);
    if (!limit.success) return NextResponse.json({ error: "Too many comments." }, { status: 429 });
    const comment = typeof body.body === "string" ? body.body.trim() : "";
    if (!comment || comment.length > 1000) return NextResponse.json({ error: "Comment must be 1–1000 characters." }, { status: 422 });
    const { data, error } = await db.from("showcase_comments").insert({ post_id: postId, user_id: userId, body: comment }).select("id, body, created_at").single();
    if (error) return NextResponse.json({ error: "Could not add comment." }, { status: 500 });
    return NextResponse.json({ comment: data }, { status: 201 });
  }
  return NextResponse.json({ error: "Invalid action." }, { status: 422 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params;
  const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", session.userId!).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member." }, { status: 403 });
  const { data, error } = await db.from("showcase_comments").select("id, user_id, body, created_at").eq("post_id", postId).order("created_at");
  if (error) return NextResponse.json({ error: "Could not load comments." }, { status: 500 });
  const userIds = [...new Set((data ?? []).map((item) => item.user_id))];
  const { data: users } = userIds.length ? await db.from("users").select("id, name").in("id", userIds) : { data: [] };
  const names = Object.fromEntries((users ?? []).map((item) => [item.id, item.name]));
  return NextResponse.json({ comments: (data ?? []).map((item) => ({ ...item, author_name: names[item.user_id] ?? "Community member" })) });
}
