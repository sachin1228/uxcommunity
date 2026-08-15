import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityMessagePage } from "@/lib/communities/read-models";
import { rateLimit } from "@/lib/auth/rate-limit";
import { moderateText } from "@/lib/moderation/text";
import { moderateWithLocalTextRules } from "@/lib/moderation/text-rules";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";
import { createServerTimer } from "@/lib/server-timing";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  const { id: communityId } = await params;
  const result = await loadCommunityMessagePage(communityId, session.userId!, {
    before: req.nextUrl.searchParams.get("before"),
    after: req.nextUrl.searchParams.get("after"),
  });

  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createServerTimer("POST /api/communities/[id]/messages");

  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user"));
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();

  // Run both rate-limit checks in parallel — each is an independent Redis call.
  const [burst, minute] = await timer.measure("rate_limits", () =>
    Promise.all([
      rateLimit(`moderation:chat:${userId}:10s`, 5, 10),
      rateLimit(`moderation:chat:${userId}:60s`, 20, 60),
    ]),
  );

  if (!burst.success) {
    return NextResponse.json(
      { error: "Too many messages. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((burst.resetAt - Date.now()) / 1000)) } },
    );
  }
  if (!minute.success) {
    return NextResponse.json(
      { error: "Too many messages. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((minute.resetAt - Date.now()) / 1000)) } },
    );
  }

  // This route uses the service-role client, which bypasses RLS. Authorize the
  // actor explicitly before allowing any community-scoped reads or writes.
  const { data: membership, error: membershipError } = await timer.measure("membership_query", async () =>
    await db
      .from("community_members")
      .select("community_id")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (membershipError) {
    return NextResponse.json({ error: "Failed to verify community membership." }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  let content: string;
  let reply_to_id: string | null = null;
  let image_url: string | null = null;
  try {
    const body  = await req.json();
    content     = (body.content ?? "").trim();
    reply_to_id = body.reply_to_id ?? null;
    image_url   = body.image_url   ?? null;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!content && !image_url) return NextResponse.json({ error: "Message cannot be empty." }, { status: 422 });
  if (content.length > 2000)  return NextResponse.json({ error: "Message too long." },        { status: 422 });

  // ── Phase 1: synchronous local-rules check (<1 ms) ───────────────────────
  // This is the only blocking moderation gate. It catches clear-cut violations
  // (phishing, spam links, banned keywords) before the DB insert so malicious
  // content never lands in the database at all.
  const localDecision = content
    ? moderateWithLocalTextRules({ content, contentType: "chat_message", userId })
    : null;
  if (localDecision && !localDecision.allowed) {
    await logModerationDecision(db, {
      userId,
      contentType: "chat_message",
      contentHash: contentHash(content),
      decision: localDecision,
    });
    return moderationFailureResponse(localDecision);
  }

  // Validate reply_to_id belongs to this community (if provided)
  if (reply_to_id) {
    const { data: parent } = await db
      .from("community_messages")
      .select("id")
      .eq("id", reply_to_id)
      .eq("community_id", communityId)
      .maybeSingle();
    if (!parent) reply_to_id = null; // silently ignore invalid reply
  }

  const { data: inserted, error: insertErr } = await timer.measure("message_insert", async () =>
    await db
      .from("community_messages")
      .insert({ community_id: communityId, user_id: userId, content: content || null, reply_to_id, image_url })
      .select("id, content, created_at, user_id, reply_to_id, image_url")
      .single(),
  );

  if (insertErr || !inserted) {
    console.error("[POST message] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }

  // ── Phase 2: AI moderation after the response is sent ────────────────────
  // `after()` runs the callback once the HTTP response has been flushed,
  // keeping POST latency to <100 ms even when the AI provider is slow.
  // If the AI rejects the message it is soft-deleted via a Realtime UPDATE,
  // which the existing UPDATE handler in useRealtimeChat already processes.
  if (content) {
    const capturedId      = inserted.id;
    const capturedContent = content;
    const capturedUserId  = userId;
    after(async () => {
      try {
        const aiDecision = await moderateText({
          content: capturedContent,
          contentType: "chat_message",
          userId: capturedUserId,
        });
        if (!aiDecision.allowed) {
          // Soft-delete triggers a Realtime UPDATE → client removes the bubble.
          const moderationDb = createServiceClient();
          await Promise.all([
            moderationDb
              .from("community_messages")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", capturedId),
            logModerationDecision(moderationDb, {
              userId: capturedUserId,
              contentType: "chat_message",
              contentRefId: capturedId,
              contentHash: contentHash(capturedContent),
              decision: aiDecision,
            }),
          ]);
        }
      } catch (err) {
        console.error("[POST message] after() AI moderation error:", err);
      }
    });
  }

  timer.finish({ query_count: reply_to_id ? 2 : 1 });

  // Return only the inserted row. The client already has the sender's own
  // name/avatar (passed as props) and the reply preview (passed in the
  // request). Fetching them again from the DB just added 2–3 extra round
  // trips to the critical path. The client merges its cached data in.
  return NextResponse.json(
    {
      message: {
        ...inserted,
        users:     null,
        reactions: [],
        reply_to:  null,
        image_url: inserted.image_url ?? null,
      },
    },
    { status: 201 }
  );
}
