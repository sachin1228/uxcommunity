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
import { publishChatEvent } from "@/lib/realtime/server";
import { createServerTimer } from "@/lib/server-timing";
import { createNotification } from "@/lib/notifications";
import { MENTION_MAX_PER_MESSAGE } from "@/lib/communities/mentions";

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

  // Run the rate-limit checks (Redis) and the membership check (DB) in
  // parallel — they're independent lookups, so running them sequentially adds
  // a full network round trip to every message send. The rate limit is still
  // enforced before any write happens; only the (cheap, PK-indexed) membership
  // read is issued alongside it.
  const [rateResult, membershipResult] = await Promise.all([
    timer.measure("rate_limits", () =>
      Promise.all([
        rateLimit(`moderation:chat:${userId}:10s`, 5, 10),
        rateLimit(`moderation:chat:${userId}:60s`, 20, 60),
      ]),
    ),
    timer.measure("membership_query", async () =>
      await db
        .from("community_members")
        .select("community_id")
        .eq("community_id", communityId)
        .eq("user_id", userId)
        .maybeSingle(),
    ),
  ]);

  const [burst, minute] = rateResult;
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
  const { data: membership, error: membershipError } = membershipResult;
  if (membershipError) {
    return NextResponse.json({ error: "Failed to verify community membership." }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  let content: string;
  let reply_to_id: string | null = null;
  let image_url: string | null = null;
  let mentionUserIds: string[] = [];
  try {
    const body = await req.json();
    content     = (body.content ?? "").trim();
    reply_to_id = body.reply_to_id ?? null;
    image_url   = body.image_url   ?? null;
    // Mentions are sent as opaque member ids picked from the client roster;
    // names are resolved server-side below so storage never trusts the client.
    if (Array.isArray(body.mentions)) {
      const ids = (body.mentions as Array<{ user_id?: unknown }>)
        .filter((m) => m && typeof m.user_id === "string")
        .map((m) => m.user_id as string)
        .filter((id: string) => id && id !== userId);
      mentionUserIds = [...new Set(ids)].slice(0, MENTION_MAX_PER_MESSAGE);
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!content && !image_url) return NextResponse.json({ error: "Message cannot be empty." }, { status: 422 });
  if (content.length > 2000)  return NextResponse.json({ error: "Message too long." },        { status: 422 });

  // Mentions only make sense when there is text to mention someone in.
  if (!content) mentionUserIds = [];

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

  // ── Resolve mentions: only members of this community, names from the DB ──
  let mentions: Array<{ user_id: string; name: string }> = [];
  if (mentionUserIds.length) {
    const { data: memberRows, error: memberErr } = (await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", communityId)
      .in("user_id", mentionUserIds)) as unknown as {
      data: Array<{ user_id: string }> | null;
      error: unknown;
    };
    if (memberErr) {
      return NextResponse.json({ error: "Failed to validate mentions." }, { status: 500 });
    }
    const memberIds = new Set((memberRows ?? []).map((m) => m.user_id));
    const validIds = mentionUserIds.filter((id) => memberIds.has(id));
    if (validIds.length) {
      const { data: nameRows } = (await db
        .from("users")
        .select("id, name")
        .in("id", validIds)) as unknown as {
        data: Array<{ id: string; name: string }> | null;
        error: unknown;
      };
      const nameById = new Map((nameRows ?? []).map((u) => [u.id, u.name]));
      mentions = validIds
        .filter((id) => nameById.has(id))
        .map((id) => ({ user_id: id, name: nameById.get(id) as string }));
    }
  }

  const { data: inserted, error: insertErr } = (await timer.measure("message_insert", async () =>
    await db
      .from("community_messages")
      .insert({ community_id: communityId, user_id: userId, content: content || null, reply_to_id, image_url, mentions })
      .select("id, content, created_at, user_id, reply_to_id, image_url, mentions")
      .single(),
  )) as unknown as {
    data: {
      id: string;
      content: string | null;
      created_at: string;
      user_id: string;
      reply_to_id: string | null;
      image_url: string | null;
      mentions: Array<{ user_id: string; name: string }>;
    } | null;
    error: unknown;
  };

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
          // Soft-delete triggers a Realtime message-delete → client removes the bubble.
          const moderationDb = createServiceClient();
          const deletedAt = new Date().toISOString();
          await Promise.all([
            moderationDb
              .from("community_messages")
              .update({ deleted_at: deletedAt })
              .eq("id", capturedId),
            logModerationDecision(moderationDb, {
              userId: capturedUserId,
              contentType: "chat_message",
              contentRefId: capturedId,
              contentHash: contentHash(capturedContent),
              decision: aiDecision,
            }),
          ]);
          // Propagate the soft-delete to the community chat room.
          await publishChatEvent({
            communityId,
            topic: "message-delete",
            data: { id: capturedId, deleted_at: deletedAt },
          });
        }
      } catch (err) {
        console.error("[POST message] after() AI moderation error:", err);
      }
    });
  }

  // ── Phase 3: mention notifications after the response is sent ─────────────
  // One bell row per mentioned member (self is already excluded during body
  // parsing). Reuses createNotification so per-entity dedupe + realtime bell
  // updates behave exactly like the other notification types.
  if (mentions.length) {
    const captured = {
      communityId,
      messageId: inserted.id,
      content: content || "",
      mentions,
    };
    after(async () => {
      try {
        const notificationDb = createServiceClient();
        const [{ data: actor }, { data: community }] = (await Promise.all([
          notificationDb.from("users").select("name").eq("id", userId).maybeSingle(),
          notificationDb.from("communities").select("name").eq("id", communityId).maybeSingle(),
        ])) as unknown as [
          { data: { name: string } | null; error: unknown },
          { data: { name: string } | null; error: unknown },
        ];
        const actorName = actor?.name ?? "Someone";
        const communityName = community?.name ?? "community";
        const bodyPreview = captured.content
          ? captured.content.replace(/\s+/g, " ").trim().slice(0, 160)
          : null;
        for (const mention of captured.mentions) {
          try {
            await createNotification(notificationDb, {
              userId: mention.user_id,
              actorId: userId,
              communityId: captured.communityId,
              type: "chat_mention",
              entityType: "message",
              entityId: captured.messageId,
              title: `${actorName} mentioned you in ${communityName}`,
              body: bodyPreview,
              href: `/dashboard/communities/${captured.communityId}#msg-${captured.messageId}`,
            });
          } catch (err) {
            console.error("[POST message] mention notification failed:", err);
          }
        }
      } catch (err) {
        console.error("[POST message] mention notification delivery failed:", err);
      }
    });
  }

  // ── Phase 4: realtime publish after the response is sent ──────────────────
  // Publish ONE event to the community chat room. Connected clients receive it
  // directly. Sidebar state is derived client-side from chat events.
  // Fire-and-forget: missed events are corrected by the client's next poll/catch-up.
  after(async () => {
    try {
      await publishChatEvent({
        communityId,
        topic: "message",
        data: {
          id: inserted.id,
          community_id: communityId,
          user_id: inserted.user_id,
          content: inserted.content ?? "",
          created_at: inserted.created_at,
          reply_to_id: inserted.reply_to_id ?? null,
          image_url: inserted.image_url ?? null,
          mentions: inserted.mentions ?? [],
        },
      });
    } catch (err) {
      console.error("[POST message] realtime publish error:", err);
    }
  });

  timer.finish({
    query_count: 1 + (reply_to_id ? 1 : 0) + (mentionUserIds.length ? 2 : 0),
  });

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
        mentions:  inserted.mentions ?? [],
      },
    },
    { status: 201 }
  );
}
