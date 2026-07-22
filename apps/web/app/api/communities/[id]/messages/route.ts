import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import type { MessageReaction, ReplyPreview } from "@/lib/communities/cache";

const PAGE_SIZE = 50;

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
    out[m.id] = { id: m.id, content: m.content, user_name: userMap[m.user_id] ?? "Unknown" };
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();
  const { searchParams } = req.nextUrl;
  const before = searchParams.get("before");
  const after  = searchParams.get("after");

  let msgQuery = db
    .from("community_messages")
    .select("id, content, created_at, user_id, reply_to_id")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });

  if (after)        msgQuery = msgQuery.gt("created_at", after);
  else if (before)  msgQuery = msgQuery.lt("created_at", before).limit(PAGE_SIZE);
  else              msgQuery = msgQuery.limit(PAGE_SIZE);

  const [{ data: membership }, { data, error }] = await Promise.all([
    db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle(),
    msgQuery,
  ]);

  if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  if (error) {
    console.error("[GET messages]", error);
    return NextResponse.json({ error: "Failed to fetch messages." }, { status: 500 });
  }

  const rows = data ?? [];
  const uniqueUserIds = [...new Set(rows.map((m) => m.user_id))];
  const messageIds    = rows.map((m) => m.id);
  const replyToIds    = [...new Set(rows.map((m) => m.reply_to_id).filter(Boolean) as string[])];

  const userMap: Record<string, { name: string; avatar_url: string | null }> = {};

  const [usersResult, reactionsResult, replyMap] = await Promise.all([
    uniqueUserIds.length
      ? Promise.all([
          db.from("users").select("id, name").in("id", uniqueUserIds),
          db.from("designer_profiles").select("user_id, avatar_url").in("user_id", uniqueUserIds),
        ])
      : Promise.resolve([
          { data: [] as { id: string; name: string }[] },
          { data: [] as { user_id: string; avatar_url: string | null }[] },
        ]),
    messageIds.length
      ? db.from("message_reactions").select("message_id, user_id, emoji").in("message_id", messageIds)
      : Promise.resolve({ data: [] as { message_id: string; user_id: string; emoji: string }[] }),
    fetchReplyPreviews(db, replyToIds),
  ]);

  if (uniqueUserIds.length) {
    const [{ data: users }, { data: profiles }] = usersResult as [
      { data: { id: string; name: string }[] | null },
      { data: { user_id: string; avatar_url: string | null }[] | null },
    ];
    const avatarMap: Record<string, string | null> = {};
    for (const p of profiles ?? []) avatarMap[p.user_id] = p.avatar_url;
    for (const u of users ?? []) userMap[u.id] = { name: u.name, avatar_url: avatarMap[u.id] ?? null };
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
    users:     userMap[m.user_id] ?? null,
    reactions: reactionsMap[m.id] ?? [],
    reply_to:  m.reply_to_id ? (replyMap[m.reply_to_id] ?? null) : null,
  }));

  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();

  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });

  let content: string;
  let reply_to_id: string | null = null;
  try {
    const body = await req.json();
    content     = (body.content ?? "").trim();
    reply_to_id = body.reply_to_id ?? null;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!content)              return NextResponse.json({ error: "Message cannot be empty." }, { status: 422 });
  if (content.length > 2000) return NextResponse.json({ error: "Message too long." },       { status: 422 });

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

  const { data: inserted, error: insertErr } = await db
    .from("community_messages")
    .insert({ community_id: communityId, user_id: userId, content, reply_to_id })
    .select("id, content, created_at, user_id, reply_to_id")
    .single();

  if (insertErr || !inserted) {
    console.error("[POST message] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }

  const [{ data: user }, { data: profile }, replyMap] = await Promise.all([
    db.from("users").select("name").eq("id", userId).single(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
    fetchReplyPreviews(db, reply_to_id ? [reply_to_id] : []),
  ]);

  return NextResponse.json(
    {
      message: {
        ...inserted,
        users:     user ? { name: user.name, avatar_url: profile?.avatar_url ?? null } : null,
        reactions: [],
        reply_to:  reply_to_id ? (replyMap[reply_to_id] ?? null) : null,
      },
    },
    { status: 201 }
  );
}
