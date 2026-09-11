import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteR2AssetIfUnreferenced, deleteOwnedR2AssetIfUnique, shouldDeletePreviousR2Asset } from "@/lib/r2";
import { parseShowcaseBody } from "@/lib/communities/showcase-validation";

/** Extract attachment URLs from a stored attachments JSON array (for R2 lookups). */
function attachmentUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "object" && item && typeof (item as Record<string, unknown>).url === "string" ? (item as Record<string, unknown>).url as string : "")).filter(Boolean);
}

/** Extract video-poster URLs from stored attachments (for R2 lookups). */
function attachmentPosterUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "object" && item ? (item as Record<string, unknown>).poster : null))
    .filter((poster): poster is string => typeof poster === "string" && poster.length > 0);
}

async function getPost(db: ReturnType<typeof createServiceClient>, communityId: string, postId: string) {
  const query = db.from("community_showcase_posts").select("*").eq("id", postId);
  return query.eq("community_id", communityId).maybeSingle();
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
  if (isPublic) return true;
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
  const parsed = parseShowcaseBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const { title, imageUrl, attachments, category, isPublic, allowReplies } = parsed.value;

  // Videos are plain file uploads — attachments are persisted exactly as the
  // validated client sent them.
  const { data, error } = await db.from("community_showcase_posts").update({ title, image_url: imageUrl, attachments, category, is_public: isPublic, allow_replies: allowReplies }).eq("id", postId).eq("user_id", userId).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Failed to update showcase post." }, { status: 500 });

  // Clean up R2 assets that are no longer part of the post (cover + attachments).
  const previousAttachments = attachmentUrls((existing as Record<string, unknown>).attachments);
  const attachmentLookups = [{ table: "community_showcase_posts", column: "attachments", getUrls: attachmentUrls }];
  for (const url of previousAttachments) {
    if (!attachments.some((next) => next.url === url)) {
      await deleteR2AssetIfUnreferenced(db, url, attachmentLookups);
    }
  }
  // Posters live at their own R2 keys — orphan them when their video goes.
  const previousPosters = attachmentPosterUrls((existing as Record<string, unknown>).attachments);
  for (const posterUrl of previousPosters) {
    if (!attachments.some((next) => next.poster === posterUrl)) {
      await deleteR2AssetIfUnreferenced(db, posterUrl, [
        { table: "community_showcase_posts", column: "attachments", getUrls: attachmentPosterUrls },
      ]);
    }
  }
  if (shouldDeletePreviousR2Asset(existing.image_url ?? null, imageUrl) && existing.image_url) {
    await deleteOwnedR2AssetIfUnique(db, existing.image_url, [
      { table: "community_showcase_posts", column: "image_url" },
    ]);
  }

  return NextResponse.json({ post: await enrich(db, data, userId) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id, postId } = await params; const userId = session.userId!; const db = createServiceClient();
  const { data: existing } = await getPost(db, id, postId);
  if (!existing) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only delete your own showcase posts." }, { status: 403 });
  const previousRow = existing as Record<string, unknown>;
  const { error } = await db.from("community_showcase_posts").delete().eq("id", postId).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Failed to delete showcase post." }, { status: 500 });

  const attachmentLookups = [{ table: "community_showcase_posts", column: "attachments", getUrls: attachmentUrls }];
  for (const url of attachmentUrls((existing as Record<string, unknown>).attachments)) {
    await deleteR2AssetIfUnreferenced(db, url, attachmentLookups);
  }
  for (const posterUrl of attachmentPosterUrls((existing as Record<string, unknown>).attachments)) {
    await deleteR2AssetIfUnreferenced(db, posterUrl, [
      { table: "community_showcase_posts", column: "attachments", getUrls: attachmentPosterUrls },
    ]);
  }
  await deleteR2AssetIfUnreferenced(db, existing.image_url, [
    { table: "community_showcase_posts", column: "image_url" },
  ]);

  return new NextResponse(null, { status: 204 });
}
