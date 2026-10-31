import { NextRequest, NextResponse, after } from "next/server";
import { assertUserActive, requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient, type ServiceClient } from "@/lib/supabase/service";
import { createServerTimer } from "@/lib/server-timing";
import {
  dmParticipants,
  dmPeerId,
  loadDmBlockEitherWay,
  loadDmConversationForUser,
  loadDmMessagePage,
  normalizeDmRequestState,
} from "@/lib/direct-messages/server";
import { resolveDmImage } from "@/lib/direct-messages/assets";
import { publishDmEvent } from "@/lib/direct-messages/publish";
import { sendDirectMessagePush } from "@/lib/push/direct-message";
import type { DmRequestState } from "@/lib/direct-messages/types";

const MAX_CONTENT_CHARS = 2000;
const MAX_IMAGE_URL_CHARS = 2048;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/dm/conversations/[id]/messages?before=…&before_id=…&after=…&after_id=… */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (e) {
    return e as Response;
  }

  const { id: conversationId } = await params;
  // Cursors are compound — (created_at, id) — so a burst of same-millisecond
  // messages can never straddle a page boundary. See dm_hardening migration.
  const result = await loadDmMessagePage(conversationId, session.userId!, {
    before: req.nextUrl.searchParams.get("before"),
    beforeId: req.nextUrl.searchParams.get("before_id"),
    after: req.nextUrl.searchParams.get("after"),
    afterId: req.nextUrl.searchParams.get("after_id"),
  });

  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}

interface ParsedSend {
  content: string;
  imageUrl: string | null;
  replyToId: string | null;
  /** The client's idempotency key for this logical send (a UUID), or null. */
  clientNonce: string | null;
}

function parseSendBody(body: unknown): { ok: true; value: ParsedSend } | { ok: false; reason: "malformed" | "empty" | "too_long" | "bad_image" | "bad_nonce" } {
  if (typeof body !== "object" || body === null) return { ok: false, reason: "malformed" };
  const record = body as Record<string, unknown>;

  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (content.length > MAX_CONTENT_CHARS) return { ok: false, reason: "too_long" };

  let imageUrl: string | null = null;
  if (record.image_url !== undefined && record.image_url !== null) {
    if (typeof record.image_url !== "string") return { ok: false, reason: "malformed" };
    const candidate = record.image_url.trim();
    if (candidate) {
      const privatePath = candidate.startsWith("/api/private/dm/");
      if (
        candidate.length > MAX_IMAGE_URL_CHARS ||
        (!privatePath && !/^https?:\/\//i.test(candidate))
      ) {
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

  let clientNonce: string | null = null;
  if (record.client_nonce !== undefined && record.client_nonce !== null) {
    if (typeof record.client_nonce !== "string" || !UUID_RE.test(record.client_nonce)) {
      return { ok: false, reason: "bad_nonce" };
    }
    clientNonce = record.client_nonce;
  }

  return { ok: true, value: { content, imageUrl, replyToId, clientNonce } };
}

/** The conversation's request columns, normalized for the response payload. */
async function readRequestState(
  db: ServiceClient,
  conversationId: string,
): Promise<{ request_state: DmRequestState; requested_by: string | null }> {
  const { data } = (await db
    .from("dm_conversations")
    .select("request_state, requested_by")
    .eq("id", conversationId)
    .maybeSingle()) as unknown as {
    data: { request_state: string; requested_by: string | null } | null;
  };
  return {
    request_state: normalizeDmRequestState(data?.request_state),
    requested_by: data?.requested_by ?? null,
  };
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
    // Liveness is still verified on this write — just not *in front of* every
    // other read. `activeCheck` runs alongside the conversation/profile reads
    // and is awaited before the insert, which removes a cold-isolate DB round
    // trip from the send path without weakening the guard.
    session = await timer.measure("auth", () =>
      requireSession("user"),
    );
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: conversationId } = await params;

  const db = createServiceClient();

  // Resolved to the error (a Response) instead of left rejecting, so an
  // inactive member is answered wherever this is awaited.
  const activeCheck = assertUserActive(userId).then(
    () => null,
    (error: unknown) => error,
  );

  const [rateResult, access, senderProfileResult] = await Promise.all([
    timer.measure("rate_limits", () =>
      Promise.all([
        rateLimit(`dm:send:${userId}:10s`, 5, 10, { failClosed: true }),
        rateLimit(`dm:send:${userId}:60s`, 20, 60, { failClosed: true }),
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

  const requestState = normalizeDmRequestState(conversation.request_state);

  // Parse the body before the database gates: the reply anchor it may carry is
  // then read in the same round trip as the block check and the request count.
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
  const { content, imageUrl, replyToId, clientNonce } = parsed.value;

  // The URL is client input, not "what the upload route just returned": only
  // this conversation's own uploads (or a GIPHY gif) may be attached. Pure
  // string validation — nothing is fetched server-side.
  const resolvedImage = imageUrl ? resolveDmImage(imageUrl, conversationId) : null;
  if (imageUrl && !resolvedImage) {
    return NextResponse.json({ error: "Invalid image URL." }, { status: 422 });
  }

  // ── Send gates: blocks + the request lifecycle ─────────────────────────
  // The insert trigger enforces all of these atomically; these pre-checks
  // exist so the member reads a sentence instead of a generic 500. They are
  // independent, so they share one round trip instead of three.
  const peerId = dmPeerId(conversation, userId);
  const [blocked, pendingCount, replyToIdValid] = await Promise.all([
    loadDmBlockEitherWay(db, userId, peerId),
    requestState === "pending" && conversation.requested_by === userId
      ? (async () => {
          // The requester holds exactly one message until the request is answered.
          const { count } = await db
            .from("dm_messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", conversationId)
            .eq("user_id", userId);
          return count ?? 0;
        })()
      : Promise.resolve(0),
    // An anchor that turns out not to exist in this conversation is silently
    // dropped rather than failing the send (same posture as the community chat).
    replyToId
      ? (async () => {
          const { data: parent } = await db
            .from("dm_messages")
            .select("id")
            .eq("id", replyToId)
            .eq("conversation_id", conversationId)
            .maybeSingle();
          return parent ? replyToId : null;
        })()
      : Promise.resolve(null),
  ]);

  if (blocked) {
    return NextResponse.json(
      { error: "You can't send messages to this member." },
      { status: 403 },
    );
  }
  if (requestState === "rejected") {
    return NextResponse.json(
      { error: "This message request was declined." },
      { status: 403 },
    );
  }
  if (pendingCount >= 1) {
    return NextResponse.json(
      { error: "You can send one message until your request is accepted." },
      { status: 403 },
    );
  }

  // The write must never happen for a member who was blocked or deleted while
  // the checks above were in flight.
  const inactive = await activeCheck;
  if (inactive) return inactive as Response;

  const { data: inserted, error: insertErr } = (await timer.measure("message_insert", async () =>
    await db
      .from("dm_messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        content: content || null,
        reply_to_id: replyToIdValid,
        // A private upload keeps its key and the authorization-gated path;
        // a GIPHY/legacy image keeps its public URL and has no key.
        image_url: resolvedImage?.url ?? null,
        image_key: resolvedImage?.key ?? null,
        // The sender-scoped idempotency key (see dm_hardening migration):
        // a retried send collides here instead of inserting a duplicate.
        client_nonce: clientNonce,
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
    error: { code?: string } | null;
  };

  if (insertErr || !inserted) {
    // 23505 on this insert can only be the (user_id, client_nonce) unique
    // index: the original send committed but its response never reached the
    // client, which is retrying with the same nonce. Return the original row
    // — do NOT re-publish (the first request already fanned it out; clients
    // dedupe by id anyway).
    if (clientNonce && insertErr?.code === "23505") {
      const { data: existing } = (await db
        .from("dm_messages")
        .select("id, content, created_at, user_id, reply_to_id, image_url, conversation_id")
        .eq("user_id", userId)
        .eq("client_nonce", clientNonce)
        .maybeSingle()) as unknown as {
        data: {
          id: string;
          content: string | null;
          created_at: string;
          user_id: string;
          reply_to_id: string | null;
          image_url: string | null;
          conversation_id: string;
        } | null;
      };

      if (existing && existing.conversation_id === conversationId) {
        const state = await readRequestState(db, conversationId);
        const timing = timer.finish({ query_count: 3 });
        return NextResponse.json(
          {
            duplicate: true,
            message: {
              id: existing.id,
              content: existing.content,
              created_at: existing.created_at,
              user_id: existing.user_id,
              reply_to_id: existing.reply_to_id,
              image_url: existing.image_url ?? null,
              conversation_id: conversationId,
              users: null,
              reactions: [],
              reply_to: null,
            },
            request_state: state.request_state,
            requested_by: state.requested_by,
          },
          { status: 200, headers: { "Server-Timing": timing } },
        );
      }
      if (existing) {
        return NextResponse.json(
          { error: "This send id was already used in another conversation." },
          { status: 409 },
        );
      }
    }
    console.error("[POST dm message] insert error:", insertErr);
    return NextResponse.json({ error: "Failed to send message." }, { status: 500 });
  }

  // The trigger may have moved the request state on this insert — the first
  // message defines the requester, and the recipient replying is an implicit
  // acceptance. Both transitions start from `pending`; `accepted` is terminal,
  // so the common send answers from the row it already has instead of paying
  // another round trip to learn nothing changed.
  const finalState =
    requestState === "accepted"
      ? { request_state: requestState, requested_by: conversation.requested_by }
      : await readRequestState(db, conversationId);
  const requestStateChanged =
    finalState.request_state !== requestState ||
    finalState.requested_by !== conversation.requested_by;

  // Fire-and-forget: the DB row is the source of truth; a missed event is
  // corrected by the client's next catch-up fetch.
  after(async () => {
    try {
      let replySenderName: string | null = null;
      let replySenderId: string | null = null;
      if (inserted.reply_to_id) {
        const { data: parentRow } = await db
          .from("dm_messages")
          .select("user_id")
          .eq("id", inserted.reply_to_id)
          .maybeSingle();
        const parentId = (parentRow as { user_id?: string } | null)?.user_id ?? null;
        if (parentId) {
          replySenderId = parentId;
          const { data: parentUser } = await db
            .from("users")
            .select("name")
            .eq("id", parentId)
            .maybeSingle();
          replySenderName = (parentUser as { name?: string } | null)?.name ?? null;
        }
      }

      const participants = dmParticipants(conversation);

      // Realtime and the device push are independent, and so is the request
      // state event: start all three together. Awaiting the publish first put
      // its HTTP round trip (with up to three retries) in front of every push,
      // which is how a slow realtime service became a late notification. Both
      // helpers swallow and log their own failures, so one cannot fail the
      // other; allSettled keeps the invocation alive until each settles.
      await Promise.allSettled([
        publishDmEvent({
          participants,
          topic: "dm-message",
          data: {
            id: inserted.id,
            conversation_id: conversationId,
            participants,
            user_id: inserted.user_id,
            sender_name: senderName,
            sender_avatar_url: senderAvatarUrl,
            content: inserted.content ?? "",
            created_at: inserted.created_at,
            reply_to_id: inserted.reply_to_id ?? null,
            reply_sender_name: replySenderName,
            reply_sender_id: replySenderId,
            image_url: inserted.image_url ?? null,
          },
        }),

        // The recipient's phone, not just their other open tab.
        sendDirectMessagePush({
          recipientId: dmPeerId(conversation, userId),
          conversationId,
          messageId: inserted.id,
          senderId: userId,
          senderName,
          senderAvatarUrl,
          content: inserted.content,
          hasImage: !!inserted.image_url,
          isReply: !!inserted.reply_to_id,
        }),

        // The request state moved with this message (first message / implicit
        // accept) — both clients patch their conversation from it.
        requestStateChanged
          ? publishDmEvent({
              participants,
              topic: "dm-request-update",
              data: {
                conversation_id: conversationId,
                request_state: finalState.request_state,
                requested_by: finalState.requested_by,
              },
            })
          : Promise.resolve(),
      ]);
    } catch (err) {
      console.error("[POST dm message] realtime publish error:", err);
    }
  });

  const timing = timer.finish({
    query_count: 3 + (replyToIdValid ? 1 : 0),
  });

  // Only the inserted row goes back — the client already has the sender's
  // identity and the reply preview it sent, and merges them in. The request
  // state rides along so the composer can swap to the waiting state (or
  // unlock, on an implicit accept) without a list refetch.
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
      request_state: finalState.request_state,
      requested_by: finalState.requested_by,
    },
    { status: 201, headers: { "Server-Timing": timing } },
  );
}
