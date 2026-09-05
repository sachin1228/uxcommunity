import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

/**
 * Vote on a thread poll (one vote per user; single choice).
 * Body: { option_index: number }.
 *
 * Votes are final: the endpoint rejects unvotes and vote changes, so a user
 * can only ever record one vote (re-voting the same option is idempotent and
 * just returns the current totals).
 */
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

  const body = (await request.json().catch(() => null)) as { option_index?: unknown } | null;
  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let threadQuery = db
    .from("community_threads")
    .select("id, user_id, community_id, poll")
    .eq("id", threadId);
  threadQuery = publicScope
    ? threadQuery.eq("is_public", true).is("community_id", null)
    : threadQuery.eq("community_id", communityId);
  const { data: thread, error: threadError } = (await threadQuery.maybeSingle()) as unknown as {
    data: { id: string; user_id: string; community_id: string | null; poll: unknown } | null;
    error: unknown;
  };
  if (threadError) {
    console.error("[LOOKUP thread for poll vote]", threadError);
    return NextResponse.json({ error: "Failed to vote on this thread." }, { status: 500 });
  }
  if (!thread) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  const poll = thread.poll as { options?: unknown } | null;
  const options = Array.isArray(poll?.options)
    ? (poll.options as unknown[]).map((option, index) => ({ index, option }))
    : [];
  if (options.length < 2) {
    return NextResponse.json({ error: "This thread does not have a poll." }, { status: 400 });
  }

  // Desired vote: an integer index into the options. Unvotes are not allowed.
  const desiredIndex = body?.option_index;
  if (!Number.isInteger(desiredIndex) || (desiredIndex as number) < 0 || (desiredIndex as number) >= options.length) {
    return NextResponse.json({ error: "Invalid poll option." }, { status: 400 });
  }

  // One final vote per user: an existing vote on a different option cannot be
  // changed, and re-voting the same option is a no-op (idempotent).
  const { data: existingVote } = await db
    .from("thread_poll_votes")
    .select("option_index")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    existingVote &&
    Number.isInteger(existingVote.option_index) &&
    (existingVote.option_index as number) !== (desiredIndex as number)
  ) {
    return NextResponse.json(
      { error: "Your vote on this poll is final and cannot be changed." },
      { status: 409 },
    );
  }
  if (!existingVote) {
    const { error } = await db
      .from("thread_poll_votes")
      .upsert(
        { thread_id: threadId, user_id: userId, option_index: desiredIndex as number },
        { onConflict: "thread_id,user_id" },
      );
    if (error) {
      console.error("[UPSERT poll vote]", error);
      return NextResponse.json({ error: "Failed to record your vote." }, { status: 500 });
    }
  }

  // Recompute authoritative totals + the caller's current vote.
  const [{ data: voteRows }, { data: mineRow }] = await Promise.all([
    db.from("thread_poll_votes").select("option_index").eq("thread_id", threadId),
    db.from("thread_poll_votes").select("option_index").eq("thread_id", threadId).eq("user_id", userId).maybeSingle(),
  ]);

  const counts = Array.from({ length: options.length }, () => 0);
  for (const vote of voteRows ?? []) {
    if (Number.isInteger(vote.option_index) && (vote.option_index as number) >= 0 && (vote.option_index as number) < counts.length) {
      counts[vote.option_index as number] += 1;
    }
  }
  const userVote = mineRow && Number.isInteger(mineRow.option_index) ? (mineRow.option_index as number) : null;

  void publishRealtimeBatch([
    {
      room: realtimeRooms.threads(communityId),
      topic: "poll",
      data: {
        event: "INSERT",
        thread_id: threadId,
        user_id: userId,
        counts,
        user_vote: userVote,
      },
    },
    {
      room: realtimeRooms.profile(thread.user_id),
      topic: "poll",
      data: {
        event: "INSERT",
        thread_id: threadId,
        user_id: userId,
        counts,
        user_vote: userVote,
      },
    },
  ]);

  return NextResponse.json({ counts, user_vote: userVote });
}
