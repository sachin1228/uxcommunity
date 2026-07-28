import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import type { MessageReaction, ReplyPreview } from "@/lib/communities/cache";
import { rateLimit } from "@/lib/auth/rate-limit";
import { moderateText } from "@/lib/moderation/text";
import { moderateWithLocalTextRules } from "@/lib/moderation/text-rules";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";

const PAGE_SIZE = 50;

/**
 * Strip year-range suffixes and singularize experience level names for display.
 * e.g. "Mid-Level Designers (3-5 years)" → "Mid-Level Designer"
 *      "Heads of Design"                 → "Head of Design"
 */
function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

/** Fetch reply previews for a batch of reply_to_ids. */
async function fetchReplyPreviews(
  db: ReturnType<typeof createServiceClient>,
  replyToIds: string[],
): Promise<Record<string, ReplyPreview>> {
  if (!replyToIds.length) return {};

  const { data: msgs } = await db
    .from("community_messages")
    .select("id, content, user_id")
    .in("id", replyToIds);

  const userIds = [...new Set((msgs ?? []).map((m) => m.user_id))];
  const { data: users } = userIds.length
    ? await db.from("users").select("id, name").in("id", userIds)
    : { data: [] as { id: string; name: string }[] };

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));

  const out: Record<string, ReplyPreview> = {};
  for (const m of msgs ?? []) {
    out[m.id] = { id: m.id, content: (m as any).content ?? "", user_name: userMap[m.user_id] ?? "Unknown" };
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  console.time("requireSession");
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  console.timeEnd("requireSession");
  const userId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();
  const { searchParams } = req.nextUrl;
  const before = searchParams.get("before");
  const after  = searchParams.get("after");

  // Fetch membership first so we can use joined_at as a lower bound on messages.
  // Members only see chat messages sent after they joined — not historical ones.
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at, history_cleared_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });

  const historyStart = membership.history_cleared_at &&
    membership.history_cleared_at > membership.joined_at
    ? membership.history_cleared_at
    : membership.joined_at;

  let msgQuery = db
    .from("community_messages")
    .select("id, content, created_at, user_id, reply_to_id, image_url, deleted_at")
    .eq("community_id", communityId)
    .gte("created_at", historyStart)   // never show messages before join/archive
    .order("created_at", { ascending: false });

  if (after)        msgQuery = msgQuery.gt("created_at", after);
  else if (before)  msgQuery = msgQuery.lt("created_at", before).limit(PAGE_SIZE);
  else              msgQuery = msgQuery.limit(PAGE_SIZE);

  const { data, error } = await msgQuery;
  if (error) {
    console.error("[GET messages]", error);
    return NextResponse.json({ error: "Failed to fetch messages." }, { status: 500 });
  }

  const rows = data ?? [];
  const uniqueUserIds = [...new Set(rows.map((m) => m.user_id))];
  const messageIds    = rows.map((m) => m.id);
  const replyToIds    = [...new Set(rows.map((m) => m.reply_to_id).filter(Boolean) as string[])];

  const userMap: Record<string, { name: string; avatar_url: string | null; designation: string | null; company: string | null }> = {};

  const [usersResult, reactionsResult, replyMap] = await Promise.all([
    uniqueUserIds.length
      ? Promise.all([
          db.from("users").select("id, name").in("id", uniqueUserIds),
          db.from("designer_profiles").select("user_id, avatar_url, experience_level, companies(name)").in("user_id", uniqueUserIds),
        ])
      : Promise.resolve([
          { data: [] as { id: string; name: string }[] },
          { data: [] as { user_id: string; avatar_url: string | null; experience_level: string | null; companies: { name: string } | null }[] },
        ]),
    messageIds.length
      ? db.from("message_reactions").select("message_id, user_id, emoji").in("message_id", messageIds)
      : Promise.resolve({ data: [] as { message_id: string; user_id: string; emoji: string }[] }),
    fetchReplyPreviews(db, replyToIds),
  ]);

  if (uniqueUserIds.length) {
    const [{ data: users }, { data: profiles }] = usersResult as [
      { data: { id: string; name: string }[] | null },
      { data: { user_id: string; avatar_url: string | null; experience_level: string | null; companies: { name: string } | null }[] | null },
    ];

    // Resolve experience level display names from slugs in a single batch query.
    const slugs = [...new Set((profiles ?? []).map((p) => p.experience_level).filter(Boolean) as string[])];
    const expLevelMap: Record<string, string> = {};
    if (slugs.length) {
      const { data: levels } = await db.from("experience_levels").select("slug, name").in("slug", slugs);
      for (const l of levels ?? []) expLevelMap[l.slug] = cleanDesignation(l.name);
    }

    const avatarMap:    Record<string, string | null> = {};
    const desigMap:     Record<string, string | null> = {};
    const companyMap:   Record<string, string | null> = {};
    for (const p of profiles ?? []) {
      avatarMap[p.user_id]  = p.avatar_url;
      desigMap[p.user_id]   = p.experience_level ? (expLevelMap[p.experience_level] ?? null) : null;
      companyMap[p.user_id] = (p.companies as any)?.name ?? null;
    }
    for (const u of users ?? []) {
      userMap[u.id] = {
        name:        u.name,
        avatar_url:  avatarMap[u.id] ?? null,
        designation: desigMap[u.id]  ?? null,
        company:     companyMap[u.id] ?? null,
      };
    }
  }

  const reactionsMap: Record<string, MessageReaction[]> = {};
  for (const r of (reactionsResult.data ?? [])) {
    if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
    const group = reactionsMap[r.message_id].find((g) => g.emoji === r.emoji);
    if (group) group.user_ids.push(r.user_id);
    else reactionsMap[r.message_id].push({ emoji: r.emoji, user_ids: [r.user_id] });
  }

  const messages = rows.reverse().map((m) => ({
    ...m,
    users:      userMap[m.user_id] ?? null,
    reactions:  reactionsMap[m.id] ?? [],
    reply_to:   m.reply_to_id ? (replyMap[m.reply_to_id] ?? null) : null,
    image_url:  (m as any).image_url  ?? null,
    deleted_at: (m as any).deleted_at ?? null,
  }));

  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const totalStart = performance.now();

  let session;
  console.time("requireSession");
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  console.timeEnd("requireSession");
  const userId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();

  // Run both rate-limit checks in parallel — each is an independent Redis call.
  console.time("rateLimit");
  const [burst, minute] = await Promise.all([
    rateLimit(`moderation:chat:${userId}:10s`, 5, 10),
    rateLimit(`moderation:chat:${userId}:60s`, 20, 60),
  ]);
  console.timeEnd("rateLimit");

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

  // Membership is verified by the DB insert itself — only members can insert
  // (enforced by RLS). Doing a pre-flight SELECT here added a full round-trip
  // before every message with no security benefit on top of RLS.

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

  console.time("insertMessage");

  const { data: inserted, error: insertErr } = await db
    .from("community_messages")
    .insert({ community_id: communityId, user_id: userId, content: content || null, reply_to_id, image_url })
    .select("id, content, created_at, user_id, reply_to_id, image_url")
    .single();

  console.timeEnd("insertMessage");

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

  console.log("TOTAL:", Math.round(performance.now() - totalStart), "ms");

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
