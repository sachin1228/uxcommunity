import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";
import type { ThreadCategory, ThreadAttachment } from "@/components/communities/threads/types";

const CATEGORIES = new Set<ThreadCategory>([
  "question", "discussion", "showcase", "resource",
  "idea", "feedback", "job", "collaboration",
]);

interface RawAttachment { name?: unknown; url?: unknown; type?: unknown; size?: unknown; }

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const tags = value.filter((t): t is string => typeof t === "string").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
  if (tags.length !== value.length || tags.some((t) => t.length > 30)) return null;
  return [...new Set(tags)].slice(0, 3);
}

function normalizeLinks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const links = value.filter((l): l is string => typeof l === "string").map((l) => l.trim());
  if (links.length !== value.length) return null;
  for (const l of links) {
    try { const u = new URL(l); if (!["http:", "https:"].includes(u.protocol)) return null; } catch { return null; }
  }
  return [...new Set(links)];
}

function normalizeAttachments(value: unknown): ThreadAttachment[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const out: ThreadAttachment[] = [];
  for (const item of value as RawAttachment[]) {
    if (typeof item.name !== "string" || typeof item.url !== "string" || typeof item.type !== "string" || typeof item.size !== "number" || item.name.length > 255 || item.url.length > 2048 || item.type.length > 100 || item.size < 0) return null;
    out.push({ name: item.name, url: item.url, type: item.type, size: item.size });
  }
  return out;
}

async function enrichThread(
  db: ReturnType<typeof createServiceClient>,
  row: Record<string, unknown>,
  currentUserId: string,
) {
  const threadId = row.id as string;
  const authorId = row.user_id as string;

  const [
    { data: userRow },
    { data: profileRow },
    { data: allVotes },
    { data: myVote },
    { data: commentCount },
  ] = await Promise.all([
    db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
    db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
    db.from("thread_votes").select("thread_id").eq("thread_id", threadId),
    db.from("thread_votes").select("thread_id").eq("thread_id", threadId).eq("user_id", currentUserId).maybeSingle(),
    db.from("thread_comments").select("id", { count: "exact", head: true }).eq("thread_id", threadId),
  ]);

  return {
    ...row,
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    vote_count: (allVotes ?? []).length,
    user_voted: Boolean(myVote),
    comment_count: commentCount ?? 0,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  // Verify membership
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });

  const { data, error } = await db
    .from("community_threads")
    .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, created_at, updated_at")
    .eq("id", threadId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (error) { console.error("[GET thread]", error); return NextResponse.json({ error: "Failed to fetch thread." }, { status: 500 }); }
  if (!data) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  return NextResponse.json({ thread: await enrichThread(db, data as Record<string, unknown>, userId) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (error) { return error as Response; }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const { data: existing } = await db.from("community_threads").select("id, user_id, community_id").eq("id", threadId).eq("community_id", communityId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only edit your own threads." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const category = body.category as ThreadCategory;
  const tags = normalizeTags(body.tags);
  const links = normalizeLinks(body.links);
  const attachments = normalizeAttachments(body.attachments);
  const allowReplies = body.allow_replies !== false;

  if (!title || title.length > 120) return NextResponse.json({ error: "Title is required and must be 120 characters or fewer." }, { status: 422 });
  if (!description || description.length > 10000) return NextResponse.json({ error: "Description is required and must be 10,000 characters or fewer." }, { status: 422 });
  if (!CATEGORIES.has(category) || !tags || !links || !attachments) return NextResponse.json({ error: "One or more thread fields are invalid." }, { status: 422 });

  const text = `${title}\n\n${description}`;
  const decision = await moderateText({ content: text, contentType: "post", userId });
  if (!decision.allowed) {
    await logModerationDecision(db, { userId, contentType: "post", contentHash: contentHash(text), decision });
    return moderationFailureResponse(decision);
  }

  const { data: updated, error } = await db
    .from("community_threads")
    .update({ title, description, category, tags, attachments, links, allow_replies: allowReplies })
    .eq("id", threadId)
    .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, created_at, updated_at")
    .single();

  if (error || !updated) { console.error("[PATCH thread]", error); return NextResponse.json({ error: "Failed to update thread." }, { status: 500 }); }

  return NextResponse.json({ thread: await enrichThread(db, updated as Record<string, unknown>, userId) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const { data: existing } = await db
    .from("community_threads")
    .select("id, user_id, community_id")
    .eq("id", threadId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only delete your own threads." }, { status: 403 });

  const { error } = await db.from("community_threads").delete().eq("id", threadId);
  if (error) { console.error("[DELETE thread]", error); return NextResponse.json({ error: "Failed to delete thread." }, { status: 500 }); }

  return new NextResponse(null, { status: 204 });
}
