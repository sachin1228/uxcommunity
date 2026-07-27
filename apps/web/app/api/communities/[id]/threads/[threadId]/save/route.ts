import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { createNotification, getActorName, threadHref } from "@/lib/notifications";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const { data: thread } = await db
    .from("community_threads")
    .select("id, user_id, title")
    .eq("id", threadId)
    .eq("community_id", communityId)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  // Toggle: check existing save
  const { data: existing } = await db
    .from("thread_saves")
    .select("thread_id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("thread_saves")
      .delete()
      .eq("thread_id", threadId)
      .eq("user_id", userId);

    if (error) {
      console.error("[DELETE save]", error);
      return NextResponse.json({ error: "Failed to unsave thread." }, { status: 500 });
    }
    return NextResponse.json({ saved: false });
  }

  const { error } = await db
    .from("thread_saves")
    .insert({ thread_id: threadId, user_id: userId });

  if (error) {
    console.error("[INSERT save]", error);
    return NextResponse.json({ error: "Failed to save thread." }, { status: 500 });
  }

  const actorName = await getActorName(db, userId);
  await createNotification(db, {
    userId: thread.user_id,
    actorId: userId,
    communityId,
    type: "thread_save",
    entityType: "thread",
    entityId: threadId,
    title: `${actorName} saved your thread`,
    body: thread.title,
    href: threadHref(communityId, threadId),
  });

  return NextResponse.json({ saved: true });
}
