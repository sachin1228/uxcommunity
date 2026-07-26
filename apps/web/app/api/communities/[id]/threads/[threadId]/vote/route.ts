import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

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

  const { threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  // Check if already voted
  const { data: existing } = await db
    .from("thread_votes")
    .select("thread_id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    // Remove vote
    const { error } = await db
      .from("thread_votes")
      .delete()
      .eq("thread_id", threadId)
      .eq("user_id", userId);

    if (error) {
      console.error("[DELETE vote]", error);
      return NextResponse.json({ error: "Failed to remove vote." }, { status: 500 });
    }
    return NextResponse.json({ voted: false });
  }

  // Add vote
  const { error } = await db
    .from("thread_votes")
    .insert({ thread_id: threadId, user_id: userId });

  if (error) {
    console.error("[INSERT vote]", error);
    return NextResponse.json({ error: "Failed to add vote." }, { status: 500 });
  }
  return NextResponse.json({ voted: true });
}
