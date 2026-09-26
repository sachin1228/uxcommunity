import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityMessagePage } from "@/lib/communities/read-models";
import { rateLimit } from "@/lib/auth/rate-limit";
import { publishChatEvent } from "@/lib/realtime/server";
import { contentTableFor } from "@/lib/communities/content-tables";
import { sendChatMessagePush } from "@/lib/push/chat";
import { createServerTimer } from "@/lib/server-timing";
import { MENTION_MAX_PER_MESSAGE } from "@/lib/communities/mentions";

/**
 * Ids of the community's recent content items (threads / showcase posts /
 * resources / events) — the chat timeline's permanent "created a …" cards.
 * Their emoji reactions ride along with each message page so the cards stay
 * current without a separate fetch.
 */
async function loadContentEventIds(communityId: string): Promise<string[]> {
  const db = createServiceClient();
  const [threads, showcase, resources, events] = await Promise.all([
    db.from("community_threads").select("id").eq("community_id", communityId).order("created_at", { ascending: false }).limit(50),
    db.from("community_showcase_posts").select("id").eq("community_id", communityId).order("created_at", { ascending: false }).limit(50),
    db.from("community_resources").select("id").eq("community_id", communityId).order("created_at", { ascending: false }).limit(50),
    db.from("community_events").select("id").eq("community_id", communityId).order("created_at", { ascending: false }).limit(50),
  ]);
  return [
    ...(threads.data ?? []),
    ...(showcase.data ?? []),
    ...(resources.data ?? []),
    ...(events.data ?? []),
  ].map((row) => (row as { id: string }).id);
}

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
  // Content-reaction groups (for the timeline's "created a …" cards) are
  // opt-in: only the chat timeline asks for them, so every other caller of this
  // endpoint skips the extra content-id lookup.
  const contentIds =
    req.nextUrl.searchParams.get("withContentReactions") === "1"
      ? await loadContentEventIds(communityId)
      : [];
  const result = await loadCommunityMessagePage(
    communityId,
    session.userId!,
    {
      before: req.nextUrl.searchParams.get("before"),
      after: req.nextUrl.searchParams.get("after"),
    },
    contentIds,
  );

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
  const [rateResult, membershipResult, senderProfileResult] = await Promise.all([
    timer.measure("rate_limits", () =>
      Promise.all([
        rateLimit(`chat:send:${userId}:10s`, 5, 10),
        rateLimit(`chat:send:${userId}:60s`, 20, 60),
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
    // Sender display info for the realtime payload published below.
    timer.measure("sender_profile", async () =>
      await Promise.all([
        db.from("users").select("name").eq("id", userId).maybeSingle(),
        db
          .from("designer_profiles")
          .select("avatar_url")
          .eq("user_id", userId)
          .maybeSingle(),
      ]),
    ),
  ]);

  const senderName =
    (senderProfileResult?.[0]?.data as { name?: string } | null)?.name ?? null;
  const senderAvatarUrl =
    (senderProfileResult?.[1]?.data as { avatar_url?: string | null } | null)?.avatar_url ?? null;

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
  let replyToContent: { id: string; kind: string } | null = null;
  let replyContentTitle: string | null = null;
  let image_url: string | null = null;
  let mentionUserIds: string[] = [];
  try {
    const body = await req.json();
    content     = (body.content ?? "").trim();
    reply_to_id = body.reply_to_id ?? null;
    // Replies can anchor to a content item (thread/showcase/resource/event —
    // the chat timeline's "created a …" cards) instead of a chat message. A
    // message anchor always wins, so this is only read when reply_to_id is
    // absent; the anchor is validated against the community below.
    if (
      !reply_to_id &&
      typeof body.reply_to_content?.id === "string" &&
      typeof body.reply_to_content?.kind === "string" &&
      ["thread", "showcase", "resource", "event"].includes(body.reply_to_content.kind)
    ) {
      replyToContent = { id: body.reply_to_content.id, kind: body.reply_to_content.kind };
    }
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

  // Validate the content-reply anchor: the item must exist in this community.
  // A message anchors to EITHER a message or a content item — message wins.
  let reply_to_content_id: string | null = null;
  const replyContentTable = replyToContent ? contentTableFor(replyToContent.kind) : null;
  if (replyToContent && replyContentTable && !reply_to_id) {
    const { data: contentRow } = await db
      .from(replyContentTable)
      .select("id, title")
      .eq("id", replyToContent.id)
      .eq("community_id", communityId)
      .maybeSingle();
    if (contentRow) {
      reply_to_content_id = replyToContent.id;
      replyContentTitle = contentRow.title ?? null;
    }
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
      const nameById = new Map((nameRows ?? []).map((u) => [u.id, u.name.trim()]));
      mentions = validIds
        .filter((id) => nameById.has(id))
        .map((id) => ({ user_id: id, name: nameById.get(id) as string }));
    }
  }

  const { data: inserted, error: insertErr } = (await timer.measure("message_insert", async () =>
    await db
      .from("community_messages")
      .insert({ community_id: communityId, user_id: userId, content: content || null, reply_to_id, reply_to_content_id, image_url, mentions })
      .select("id, content, created_at, user_id, reply_to_id, reply_to_content_id, image_url, mentions")
      .single(),
  )) as unknown as {
    data: {
      id: string;
      content: string | null;
      created_at: string;
      user_id: string;
      reply_to_id: string | null;
      /** Set when the message anchors to a "created a …" card. */
      reply_to_content_id: string | null;
      image_url: string | null;
      mentions: Array<{ user_id: string; name: string }>;
    } | null;
    error: unknown;
  };

  if (insertErr || !inserted) {
    console.error("[POST message] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }

  // ── Realtime publish after the response is sent ─────────────────────────
  // Publish ONE event to the community chat room. Connected clients receive it
  // directly. Sidebar state is derived client-side from chat events.
  // Fire-and-forget: missed events are corrected by the client's next catch-up
  // fetch (reconnect, tab return) or the next message-page load.
  // sender_name rides along on the event: without it every receiving client
  // rendered "Someone: …" in the sidebar preview (and an anonymous sender row
  // in the chat) until its per-user profile fetch round-tripped — the
  // "Someone said hi → John: hi" flicker.
  after(async () => {
    try {
      let replySenderName: string | null = null;
      if (reply_to_id) {
        const { data: parentRow } = await db
          .from("community_messages")
          .select("user_id")
          .eq("id", reply_to_id)
          .maybeSingle();
        const parentId = (parentRow as { user_id?: string } | null)?.user_id ?? null;
        if (parentId) {
          const { data: parentUser } = await db
            .from("users")
            .select("name")
            .eq("id", parentId)
            .maybeSingle();
          replySenderName = (parentUser as { name?: string } | null)?.name ?? null;
        }
      }
      await publishChatEvent({
        communityId,
        topic: "message",
        data: {
          id: inserted.id,
          community_id: communityId,
          user_id: inserted.user_id,
          sender_name: senderName,
          sender_avatar_url: senderAvatarUrl,
          content: inserted.content ?? "",
          created_at: inserted.created_at,
          reply_to_id: inserted.reply_to_id ?? null,
          reply_sender_name: replySenderName,
          // Content-anchored replies carry their own preview fields.
          reply_to_content_id: inserted.reply_to_content_id ?? null,
          reply_content_kind: reply_to_content_id ? replyToContent!.kind : null,
          reply_content_title: reply_to_content_id ? replyContentTitle : null,
          image_url: inserted.image_url ?? null,
          mentions: inserted.mentions ?? [],
        },
      });

      // Wake every other member's device. Realtime only reaches an app that is
      // running — once the OS suspends it the socket dies — so background
      // delivery has to go through Expo's push service.
      await sendChatMessagePush({
        communityId,
        messageId: inserted.id,
        senderId: inserted.user_id,
        senderName,
        content: inserted.content ?? null,
        hasImage: !!inserted.image_url,
        isReply: !!inserted.reply_to_id,
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
        reply_to_content_id,
        reply_content_kind: reply_to_content_id ? replyToContent!.kind : null,
        reply_content_title: reply_to_content_id ? replyContentTitle : null,
        image_url: inserted.image_url ?? null,
        mentions:  inserted.mentions ?? [],
      },
    },
    { status: 201 }
  );
}
