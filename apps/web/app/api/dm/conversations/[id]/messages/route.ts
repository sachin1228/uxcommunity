import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { createServerTimer } from "@/lib/server-timing";
import {
  dmParticipants,
  loadDmConversationForUser,
  loadDmMessagePage,
} from "@/lib/direct-messages/server";
import { publishDmEvent } from "@/lib/direct-messages/publish";

const MAX_CONTENT_CHARS = 2000;
const MAX_IMAGE_URL_CHARS = 2048;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/dm/conversations/[id]/messages?before=…&after=… */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  const { id: conversationId } = await params;
  const result = await loadDmMessagePage(conversationId, session.userId!, {
    before: req.nextUrl.searchParams.get("before"),
    after: req.nextUrl.searchParams.get("after"),
  });

  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}

interface ParsedSend {
  content: string;
  imageUrl: string | null;
  replyToId: string | null;
}

function parseSendBody(body: unknown): { ok: true; value: ParsedSend } | { ok: false; reason: "malformed" | "empty" | "too_long" | "bad_image" } {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "malformed" };
  const record = body as Record<string, unknown>;

  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (content.length > MAX_CONTENT_CHARS) return { ok: false, reason: "too_long" };

  let imageUrl: string | null = null;
  if (record.image_url !== undefined && record.image_url !== null) {
    if (typeof record.image_url !== "string") return { ok: false, reason: "malformed" };
    const candidate = record.image_url.trim();
    if (candidate) {
      if (candidate.length > MAX_IMAGE_URL_CHARS || !/^https?:\/\//i.test(candidate)) {
        return { ok: false, reason: "bad_image" };
      }
      imageUrl = candidate;
    }
  }

  if (!content && !imageUrl) return { ok: false, reason: "empty" };

  let replyToId: string | null = null;
  if (record.reply_to_id !== undefined && record.reply_to_id !== null) {
    if (typeof record.reply_to_id !== "string" || !UUID_RE.test(record.reply_to_id)) {
      return { ok: false, reason: "malformed" };
    }
    replyToId = record.reply_to_id;
  }

  return { ok: true, value: { content, imageUrl, replyToId } };
}

/**
 * POST /api/dm/conversations/[id]/messages
 *
 * Send one DM. The DB row is committed first and answers the caller; the
 * realtime fan-out (recipient + sender's other tabs) runs in `after()`, so a
 * slow publish never delays the sender. Body mirrors the community chat's
 * send: text, an optional image URL (upload first) and an optional reply.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = createServerTimer("POST /api/dm/conversations/[id]/messages");

  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user"));
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: conversationId } = await params;

  const db = createServiceClient();

  const [rateResult, access, senderProfileResult] = await Promise.all([
    timer.measure("rate_limits", () =>
      Promise.all([
        rateLimit(`dm:send:${userId}:10s`, 5, 10),
        rateLimit(`dm:send:${userId}:60s`, 20, 60),
      ]),
    ),
    timer.measure("conversation_query", () =>
      loadDmConversationForUser(db, conversationId, userId),
    ),
    // Sender display info for the realtime payload published below.
    timer.measure("sender_profile", async () =>
      await Promise.all([
        db.from("users").select("name").eq("id", userId).maybeSingle(),
        db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
      ]),
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

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const conversation = access.conversation;

  const senderName =
    (senderProfileResult[0]?.data as { name?: string } | null)?.name ?? null;
  const senderAvatarUrl =
    (senderProfileResult[1]?.data as { avatar_url?: string | null } | null)?.avatar_url ?? null;

  const parsed = parseSendBody(await req.json().catch(() => null));
  if (!parsed.ok) {
    if (parsed.reason === "empty") {
      return NextResponse.json({ error: "Message cannot be empty." }, { status: 422 });
    }
    if (parsed.reason === "too_long") {
      return NextResponse.json({ error: "Message too long." }, { status: 422 });
    }
    if (parsed.reason === "bad_image") {
      return NextResponse.json({ error: "Invalid image URL." }, { status: 422 });
    }
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { content, imageUrl, replyToId } = parsed.value;

  // An anchor that turns out not to exist in this conversation is silently
  // dropped rather than failing the send (same posture as the community chat).
  let replyToIdValid: string | null = null;
  if (replyToId) {
    const { data: parent } = await db
      .from("dm_messages")
      .select("id")
      .eq("id", replyToId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (parent) replyToIdValid = replyToId;
  }

  const { data: inserted, error: insertErr } = (await timer.measure("message_insert", async () =>
    await db
      .from("dm_messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        content: content || null,
        reply_to_id: replyToIdValid,
        image_url: imageUrl,
      })
      .select("id, content, created_at, user_id, reply_to_id, image_url")
      .single(),
  )) as unknown as {
    data: {
      id: string;
      content: string | null;
      created_at: string;
      user_id: string;
      reply_to_id: string | null;
      image_url: string | null;
    } | null;
    error: unknown;
  };

  if (insertErr || !inserted) {
    console.error("[POST dm message] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }

  // Fire-and-forget: the DB row is the source of truth; a missed event is
  // corrected by the client's next catch-up fetch.
  after(async () => {
    try {
      let replySenderName: string | null = null;
      if (inserted.reply_to_id) {
        const { data: parentRow } = await db
          .from("dm_messages")
          .select("user_id")
          .eq("id", inserted.reply_to_id)
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

      await publishDmEvent({
        participants: dmParticipants(conversation),
        topic: "dm-message",
        data: {
          id: inserted.id,
          conversation_id: conversationId,
          participants: dmParticipants(conversation),
          user_id: inserted.user_id,
          sender_name: senderName,
          sender_avatar_url: senderAvatarUrl,
          content: inserted.content ?? "",
          created_at: inserted.created_at,
          reply_to_id: inserted.reply_to_id ?? null,
          reply_sender_name: replySenderName,
          image_url: inserted.image_url ?? null,
        },
      });
    } catch (err) {
      console.error("[POST dm message] realtime publish error:", err);
    }
  });

  const timing = timer.finish({
    query_count: 2 + (replyToIdValid ? 1 : 0),
  });

  // Only the inserted row goes back — the client already has the sender's
  // identity and the reply preview it sent, and merges them in.
  return NextResponse.json(
    {
      message: {
        ...inserted,
        conversation_id: conversationId,
        users: null,
        reactions: [],
        reply_to: null,
        image_url: inserted.image_url ?? null,
      },
    },
    { status: 201, headers: { "Server-Timing": timing } },
  );
}
