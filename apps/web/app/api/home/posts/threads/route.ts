import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { contentHash } from "@/lib/moderation/normalize";
import { logModerationDecision } from "@/lib/moderation/log";
import type { ThreadAttachment, ThreadCategory } from "@/components/communities/threads/types";

const CATEGORIES = new Set<ThreadCategory>([
  "question", "discussion", "idea", "feedback", "referral", "collaboration",
]);

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
  if (tags.length !== value.length || tags.some((tag) => tag.length > 30)) return null;
  return [...new Set(tags)].slice(0, 3);
}

function normalizeLinks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const links = value.filter((link): link is string => typeof link === "string").map((link) => link.trim());
  if (links.length !== value.length) return null;
  for (const link of links) {
    try {
      const url = new URL(link);
      if (!["http:", "https:"].includes(url.protocol)) return null;
    } catch {
      return null;
    }
  }
  return [...new Set(links)];
}

function normalizeAttachments(value: unknown): ThreadAttachment[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const attachments: ThreadAttachment[] = [];
  for (const item of value as Array<Record<string, unknown>>) {
    if (
      typeof item.name !== "string" ||
      typeof item.url !== "string" ||
      typeof item.type !== "string" ||
      typeof item.size !== "number" ||
      item.name.length > 255 ||
      item.url.length > 2048 ||
      item.type.length > 100 ||
      item.size < 0
    ) return null;
    attachments.push({
      name: item.name,
      url: item.url,
      type: item.type,
      size: item.size,
    });
  }
  return attachments;
}

export async function POST(request: NextRequest) {
  let session;
  try { session = await requireSession("user"); } catch (error) { return error as Response; }

  const userId = session.userId!;
  const limit = await rateLimit(`home-thread:create:${userId}:60s`, 10, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many posts. Please try again shortly." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const category = body.category as ThreadCategory;
  const tags = normalizeTags(body.tags);
  const links = normalizeLinks(body.links);
  const attachments = normalizeAttachments(body.attachments);
  const allowReplies = body.allow_replies !== false;

  if (!title || title.length > 120 || !description || description.length > 10000) {
    return NextResponse.json({ error: "Title and description are required." }, { status: 422 });
  }
  if (!CATEGORIES.has(category) || !tags || !links || !attachments) {
    return NextResponse.json({ error: "One or more thread fields are invalid." }, { status: 422 });
  }

  const text = `${title}\n\n${description}`;
  const db = createServiceClient() as any;
  const decision = await moderateText({ content: text, contentType: "post", userId });
  if (!decision.allowed) {
    await logModerationDecision(db, {
      userId,
      contentType: "post",
      contentHash: contentHash(text),
      decision,
    });
    return moderationFailureResponse(decision);
  }

  const { data: inserted, error } = await db
    .from("community_threads")
    .insert({
      community_id: null,
      user_id: userId,
      title,
      description,
      category,
      tags,
      attachments,
      links,
      allow_replies: allowReplies,
      is_public: true,
    })
    .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, is_public, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST home thread]", error);
    return NextResponse.json({ error: "Failed to create thread." }, { status: 500 });
  }

  await logModerationDecision(db, {
    userId,
    contentType: "post",
    contentRefId: inserted.id,
    contentHash: contentHash(text),
    decision,
  });

  const { data: user } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  const { data: profile } = await db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle();
  return NextResponse.json({
    thread: {
      ...inserted,
      users: user ? { name: user.name, avatar_url: profile?.avatar_url ?? null } : null,
      vote_count: 0,
      user_voted: false,
      user_saved: false,
      comment_count: 0,
    },
  }, { status: 201 });
}