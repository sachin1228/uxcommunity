import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const PAGE_SIZE = 50;

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

  // Run membership check and message fetch in parallel
  let msgQuery = db
    .from("community_messages")
    .select("id, content, created_at, user_id")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });

  if (after) {
    // Incremental fetch: only messages newer than the given timestamp
    msgQuery = msgQuery.gt("created_at", after);
  } else if (before) {
    // Pagination: messages older than the given timestamp
    msgQuery = msgQuery.lt("created_at", before).limit(PAGE_SIZE);
  } else {
    msgQuery = msgQuery.limit(PAGE_SIZE);
  }

  const [{ data: membership }, { data, error }] = await Promise.all([
    db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle(),
    msgQuery,
  ]);

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }
  if (error) {
    console.error("[GET messages] Supabase error:", error);
    return NextResponse.json({ error: "Failed to fetch messages." }, { status: 500 });
  }

  // Batch-fetch unique senders in one round-trip
  const uniqueUserIds = [...new Set((data ?? []).map((m) => m.user_id))];
  const userMap: Record<string, { name: string; avatar_url: string | null }> = {};

  if (uniqueUserIds.length) {
    const [{ data: users }, { data: profiles }] = await Promise.all([
      db.from("users").select("id, name").in("id", uniqueUserIds),
      db.from("designer_profiles").select("user_id, avatar_url").in("user_id", uniqueUserIds),
    ]);
    const avatarMap: Record<string, string | null> = {};
    for (const p of profiles ?? []) avatarMap[p.user_id] = p.avatar_url;
    for (const u of users ?? []) {
      userMap[u.id] = { name: u.name, avatar_url: avatarMap[u.id] ?? null };
    }
  }

  // Return oldest-first for display
  const messages = (data ?? [])
    .reverse()
    .map((m) => ({ ...m, users: userMap[m.user_id] ?? null }));

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

  // Verify membership
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  let content: string;
  try {
    const body = await req.json();
    content = (body.content ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!content) return NextResponse.json({ error: "Message cannot be empty." }, { status: 422 });
  if (content.length > 2000) return NextResponse.json({ error: "Message too long." }, { status: 422 });

  // Insert the message
  const { data: inserted, error: insertErr } = await db
    .from("community_messages")
    .insert({ community_id: communityId, user_id: userId, content })
    .select("id, content, created_at, user_id")
    .single();

  if (insertErr || !inserted) {
    console.error("[POST message] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }

  // Fetch sender info in parallel
  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).single(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);

  return NextResponse.json(
    {
      message: {
        ...inserted,
        users: user
          ? { name: user.name, avatar_url: profile?.avatar_url ?? null }
          : null,
      },
    },
    { status: 201 }
  );
}
