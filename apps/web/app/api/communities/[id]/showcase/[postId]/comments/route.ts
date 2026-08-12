import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

async function access(db: ReturnType<typeof createServiceClient>, communityId: string, postId: string, userId: string) {
  const [{ data: membership }, { data: post }] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("community_showcase_posts").select("id").eq("community_id", communityId).eq("id", postId).maybeSingle(),
  ]);
  return Boolean(membership && post);
}

async function enrich(db: ReturnType<typeof createServiceClient>, rows: Array<Record<string, unknown>>) {
  const ids = [...new Set(rows.map((row) => row.user_id as string))];
  const [{ data: users }, { data: profiles }] = ids.length ? await Promise.all([db.from("users").select("id, name").in("id", ids), db.from("designer_profiles").select("user_id, avatar_url").in("user_id", ids)]) : [{ data: [] }, { data: [] }];
  const names = Object.fromEntries((users ?? []).map((user) => [user.id, user.name])); const avatars = Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_url]));
  return rows.map((row) => ({ ...row, users: { name: names[row.user_id as string] ?? "Community member", avatar_url: avatars[row.user_id as string] ?? null }, replies: [] as Record<string, unknown>[] }));
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const db = createServiceClient();
  if (!(await access(db, id, postId, session.userId!))) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  const { data, error } = await db.from("showcase_comments").select("id, post_id, user_id, parent_id, body, created_at, updated_at").eq("post_id", postId).order("created_at");
  if (error) return NextResponse.json({ error: "Failed to load comments." }, { status: 500 });
  const comments = await enrich(db, (data ?? []) as Array<Record<string, unknown>>); const top = comments.filter((comment) => !comment.parent_id);
  for (const reply of comments.filter((comment) => comment.parent_id)) { const parent = top.find((comment) => comment.id === reply.parent_id); if (parent) parent.replies.push(reply); }
  return NextResponse.json({ comments: top });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const userId = session.userId!; const db = createServiceClient();
  if (!(await access(db, id, postId, userId))) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  const limit = await rateLimit(`showcase:comment:${userId}:60s`, 15, 60); if (!limit.success) return NextResponse.json({ error: "Too many comments." }, { status: 429 });
  let payload: Record<string, unknown>; try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const body = typeof payload.body === "string" ? payload.body.trim() : ""; const parentId = typeof payload.parent_id === "string" ? payload.parent_id : null;
  if (!body || body.length > 1000) return NextResponse.json({ error: "Comment must be 1–1000 characters." }, { status: 422 });
  if (parentId) { const { data: parent } = await db.from("showcase_comments").select("id, parent_id").eq("id", parentId).eq("post_id", postId).maybeSingle(); if (!parent) return NextResponse.json({ error: "Parent comment not found." }, { status: 404 }); if (parent.parent_id) return NextResponse.json({ error: "Cannot reply to a reply." }, { status: 422 }); }
  const { data, error } = await db.from("showcase_comments").insert({ post_id: postId, user_id: userId, parent_id: parentId, body }).select("id, post_id, user_id, parent_id, body, created_at, updated_at").single();
  if (error || !data) return NextResponse.json({ error: "Failed to post comment." }, { status: 500 });
  const [comment] = await enrich(db, [data]); return NextResponse.json({ comment }, { status: 201 });
}
