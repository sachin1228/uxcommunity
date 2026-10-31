import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  findOrCreateDmConversation,
  loadDmConversations,
  loadDmPeer,
} from "@/lib/direct-messages/server";
import type { DmConversationSummary } from "@/lib/direct-messages/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/dm/conversations — the DM pane's list, one RPC round trip. */
export async function GET() {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (e) {
    return e as Response;
  }

  const result = await loadDmConversations(session.userId!);
  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}

/**
 * POST /api/dm/conversations  { peer_user_id }
 *
 * Create-or-get the 1:1 conversation with a member. Returns the conversation
 * plus the peer's display identity, shaped exactly like a list row — a brand
 * new conversation has no messages yet, which is what the thread's empty
 * state renders.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;

  let peerUserId: string;
  try {
    const body = (await req.json()) as { peer_user_id?: unknown };
    peerUserId = typeof body.peer_user_id === "string" ? body.peer_user_id : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!peerUserId || !UUID_RE.test(peerUserId)) {
    return NextResponse.json({ error: "Invalid member." }, { status: 422 });
  }
  if (peerUserId === userId) {
    return NextResponse.json({ error: "You cannot message yourself." }, { status: 422 });
  }

  const db = createServiceClient();

  const [limitResult, peer] = await Promise.all([
    rateLimit(`dm:create:${userId}:60s`, 30, 60, { failClosed: true }),
    loadDmPeer(db, peerUserId),
  ]);
  if (!limitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limitResult.resetAt - Date.now()) / 1000)) } },
    );
  }
  if (!peer) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const result = await findOrCreateDmConversation(userId, peerUserId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const conversation: DmConversationSummary = {
    id: result.conversation.id,
    peer,
    last_message: null,
    unread_count: 0,
    my_last_read_at: result.conversation.my_last_read_at,
    last_message_at: result.conversation.last_message_at,
    request_state: result.conversation.request_state,
    requested_by: result.conversation.requested_by,
    blocked_by_me: result.conversation.blocked_by_me,
  };
  return NextResponse.json({ conversation }, { status: 201 });
}
