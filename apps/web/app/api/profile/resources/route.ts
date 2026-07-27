import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId!;
  const db = createServiceClient();

  const { data, error } = await db
    .from("community_resources")
    .select(
      "id, community_id, user_id, title, description, resource_type, url, tags, created_at, updated_at, communities(name)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET profile resources]", error);
    return NextResponse.json({ error: "Failed to fetch your resources." }, { status: 500 });
  }

  const resources = (data ?? []).map((r) => {
    const raw = (r as { communities?: unknown }).communities;
    const community: { name: string } | null =
      !raw ? null : Array.isArray(raw) ? ((raw[0] as { name: string }) ?? null) : (raw as { name: string });
    return { ...r, communities: undefined, community };
  });

  if (!resources.length) return NextResponse.json({ resources: [] });

  const resourceIds = resources.map((r) => r.id);
  const [{ data: allSaves }, { data: mySaves }, { data: allBookmarks }, { data: myBookmarks }, { data: allComments }, { data: profile }] =
    await Promise.all([
      db.from("resource_saves").select("resource_id").in("resource_id", resourceIds),
      db.from("resource_saves").select("resource_id").in("resource_id", resourceIds).eq("user_id", userId),
      db.from("resource_bookmarks").select("resource_id").in("resource_id", resourceIds),
      db.from("resource_bookmarks").select("resource_id").in("resource_id", resourceIds).eq("user_id", userId),
      db.from("resource_comments").select("resource_id").in("resource_id", resourceIds),
      db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
    ]);

  const saveCountMap: Record<string, number> = {};
  for (const s of allSaves ?? []) saveCountMap[s.resource_id] = (saveCountMap[s.resource_id] ?? 0) + 1;

  const bookmarkCountMap: Record<string, number> = {};
  for (const b of allBookmarks ?? []) bookmarkCountMap[b.resource_id] = (bookmarkCountMap[b.resource_id] ?? 0) + 1;

  const commentCountMap: Record<string, number> = {};
  for (const c of allComments ?? []) commentCountMap[c.resource_id] = (commentCountMap[c.resource_id] ?? 0) + 1;

  const mySaveSet = new Set((mySaves ?? []).map((s) => s.resource_id));
  const myBookmarkSet = new Set((myBookmarks ?? []).map((b) => b.resource_id));
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;

  return NextResponse.json({
    resources: resources.map((r) => ({
      ...r,
      save_count: saveCountMap[r.id] ?? 0,
      user_saved: mySaveSet.has(r.id),
      comment_count: commentCountMap[r.id] ?? 0,
      bookmark_count: bookmarkCountMap[r.id] ?? 0,
      user_bookmarked: myBookmarkSet.has(r.id),
      users: null, // patched client-side
    })),
    avatarUrl,
  });
}
