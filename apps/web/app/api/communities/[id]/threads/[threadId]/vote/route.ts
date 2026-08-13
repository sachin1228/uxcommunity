import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deferNotification, threadHref } from "@/lib/notifications";
import { isPublicContentScope } from "@/lib/content-scope";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const body = (await request.json().catch(() => null)) as { voted?: unknown } | null;
  if (typeof body?.voted !== "boolean") {
    return NextResponse.json({ error: "A boolean voted state is required." }, { status: 400 });
  }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let threadQuery = db
    .from("community_threads")
    .select("id, user_id, title")
    .eq("id", threadId);
  threadQuery = publicScope
    ? threadQuery.eq("is_public", true).is("community_id", null)
    : threadQuery.eq("community_id", communityId);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError) {
    console.error("[LOOKUP thread for vote]", threadError);
    return NextResponse.json({ error: "Failed to update like." }, { status: 500 });
  }
  if (!thread) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  const { data: existing, error: lookupError } = await db
    .from("thread_votes")
    .select("thread_id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) {
    console.error("[LOOKUP vote]", lookupError);
    return NextResponse.json({ error: "Failed to update like." }, { status: 500 });
  }

  if (body.voted) {
    const { error } = await db
      .from("thread_votes")
      .upsert(
        { thread_id: threadId, user_id: userId },
        { onConflict: "thread_id,user_id", ignoreDuplicates: true },
      );

    if (error) {
      console.error("[UPSERT vote]", error);
      return NextResponse.json({ error: "Failed to add like." }, { status: 500 });
    }

    if (!existing) {
      deferNotification({
        userId: thread.user_id,
        actorId: userId,
        communityId,
        type: "thread_vote",
        entityType: "thread",
        entityId: threadId,
        title: (actorName) => `${actorName} liked your thread`,
        body: thread.title,
        href: threadHref(communityId, threadId),
      });
    }

    const { count, error: countError } = await db
      .from("thread_votes")
      .select("thread_id", { count: "exact", head: true })
      .eq("thread_id", threadId);

    if (countError) {
      console.error("[COUNT votes]", countError);
      return NextResponse.json({ error: "Like saved, but its count could not be confirmed." }, { status: 500 });
    }

    return NextResponse.json({ voted: true, count: count ?? 0 });
  }

  const { error } = await db
    .from("thread_votes")
    .delete()
    .eq("thread_id", threadId)
    .eq("user_id", userId);

  if (error) {
    console.error("[DELETE vote]", error);
    return NextResponse.json({ error: "Failed to remove like." }, { status: 500 });
  }

  const { count, error: countError } = await db
    .from("thread_votes")
    .select("thread_id", { count: "exact", head: true })
    .eq("thread_id", threadId);

  if (countError) {
    console.error("[COUNT votes]", countError);
    return NextResponse.json({ error: "Like removed, but its count could not be confirmed." }, { status: 500 });
  }

  return NextResponse.json({ voted: false, count: count ?? 0 });
}
