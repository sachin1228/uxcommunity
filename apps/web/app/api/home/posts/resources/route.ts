import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import type { ResourceType } from "@/components/communities/resources/types";

const RESOURCE_TYPES = new Set<ResourceType>([
  "figma", "article", "tool", "video", "book", "font", "icon_pack",
  "color", "template", "inspiration", "other",
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

export async function POST(request: NextRequest) {
  let session;
  try { session = await requireSession("user"); } catch (error) { return error as Response; }

  const userId = session.userId!;
  const limit = await rateLimit(`home-resource:create:${userId}:60s`, 10, 60);
  if (!limit.success) return NextResponse.json({ error: "Too many resources. Please try again shortly." }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const resourceType = body.resource_type as ResourceType;
  const tags = normalizeTags(body.tags);

  if (!title || title.length > 120 || !url || url.length > 2048) {
    return NextResponse.json({ error: "Title and URL are required." }, { status: 422 });
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "URL must start with http:// or https://" }, { status: 422 });
  }
  if (!RESOURCE_TYPES.has(resourceType) || !tags || (description && description.length > 2000)) {
    return NextResponse.json({ error: "One or more resource fields are invalid." }, { status: 422 });
  }

  const db = createServiceClient() as any;
  const { data: inserted, error } = await db
    .from("community_resources")
    .insert({
      community_id: null,
      user_id: userId,
      title,
      url,
      description,
      resource_type: resourceType,
      tags,
      is_public: true,
    })
    .select("id, community_id, user_id, title, description, resource_type, url, tags, is_public, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST home resource]", error);
    return NextResponse.json({ error: "Failed to create resource." }, { status: 500 });
  }

  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);
  return NextResponse.json({
    resource: {
      ...inserted,
      users: user ? { name: user.name, avatar_url: profile?.avatar_url ?? null } : null,
      save_count: 0,
      user_saved: false,
      comment_count: 0,
      bookmark_count: 0,
      user_bookmarked: false,
    },
  }, { status: 201 });
}