import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { attachCommentAuthors } from "@/lib/communities/comment-authors";
import { attachCommentReactions } from "@/lib/communities/comment-reactions";

async function access(db: ReturnType<typeof createServiceClient>, communityId: string, postId: string, userId: string, requireRepliesEnabled = false) {
  const postQuery = db.from("community_showcase_posts").select("id, is_public, allow_replies").eq("id", postId).eq("community_id", communityId);
  const [membership, { data: postRaw }] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    postQuery.maybeSingle(),
  ]);
  const post = postRaw as { is_public: boolean; allow_replies: boolean } | null;
  if (!post) return false;
  if (requireRepliesEnabled && !post.allow_replies) return false;
  // Non-members can still comment on a community post that was published
  // publicly — the home feed surfaces these to everyone.
  return Boolean(membership) || post.is_public === true;
}

async function enrich(
  db: ReturnType<typeof createServiceClient>,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown> & { replies: Record<string, unknown>[] }>> {
  // One shared author resolver, so a comment author reads the same here as on
  // the thread / resource / event surfaces and in the members list. The rows
  // stay index-accessible for the reply nesting at the call site.
  const authored = await attachCommentAuthors(db, rows);
  return authored.map(
    (row) =>
      ({ ...row, replies: [] as Record<string, unknown>[] }) as Record<string, unknown> & {
        replies: Record<string, unknown>[];
      },
  );
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const db = createServiceClient();
  if (!(await access(db, id, postId, session.userId!))) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  const { data, error } = await db.from("showcase_comments").select("id, post_id, user_id, parent_id, body, created_at, updated_at").eq("post_id", postId).order("created_at");
  if (error) return NextResponse.json({ error: "Failed to load comments." }, { status: 500 });
  // Grouped emoji reactions per comment, attached before nesting so replies
  // carry their reactions too.
  const comments = await attachCommentReactions(db, await enrich(db, (data ?? []) as Array<Record<string, unknown>>), session.userId!, "showcase"); const top = comments.filter((comment) => !comment.parent_id);
  for (const reply of comments.filter((comment) => comment.parent_id)) { const parent = top.find((comment) => comment.id === reply.parent_id); if (parent) parent.replies.push(reply); }
  return NextResponse.json({ comments: top });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const userId = session.userId!; const db = createServiceClient();
  if (!(await access(db, id, postId, userId, true))) return NextResponse.json({ error: "Comments are not allowed on this showcase." }, { status: 403 });
  const limit = await rateLimit(`showcase:comment:${userId}:60s`, 15, 60); if (!limit.success) return NextResponse.json({ error: "Too many comments." }, { status: 429 });
  let payload: Record<string, unknown>; try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const body = typeof payload.body === "string" ? payload.body.trim() : ""; const parentId = typeof payload.parent_id === "string" ? payload.parent_id : null;
  if (!body || body.length > 1000) return NextResponse.json({ error: "Comment must be 1–1000 characters." }, { status: 422 });
  if (parentId) { const { data: parent } = await db.from("showcase_comments").select("id, parent_id").eq("id", parentId).eq("post_id", postId).maybeSingle(); if (!parent) return NextResponse.json({ error: "Parent comment not found." }, { status: 404 }); if (parent.parent_id) return NextResponse.json({ error: "Cannot reply to a reply." }, { status: 422 }); }
  const { data, error } = await db.from("showcase_comments").insert({ post_id: postId, user_id: userId, parent_id: parentId, body }).select("id, post_id, user_id, parent_id, body, created_at, updated_at").single();
  if (error || !data) return NextResponse.json({ error: "Failed to post comment." }, { status: 500 });
  after(() => {
    void publishRealtimeBatch([{ room: realtimeRooms.showcase(postId), topic: "comment", data: { user_id: userId } }]);
  });
  const [comment] = await attachCommentReactions(db, await enrich(db, [data]), userId, "showcase"); return NextResponse.json({ comment }, { status: 201 });
}
