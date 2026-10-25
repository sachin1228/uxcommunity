import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { dmParticipants, loadDmConversationForUser } from "@/lib/direct-messages/server";
import { publishDmEvent } from "@/lib/direct-messages/publish";

/**
 * POST /api/dm/conversations/[id]/typing  { typing: boolean }
 *
 * Relay a typing pulse to the peer. The community chat broadcasts typing
 * straight over the room's WebSocket, but a DM typing pulse must cross to the
 * OTHER member's Durable Object, which only the server publish path can do —
 * so it costs one throttled request instead. The client sends at most one
 * pulse per second and a stop-pulse; the rate limit backstops a broken client.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    // A presence ping is not a message; read-only accounts may still type.
    session = await requireSession("user", { allowUnverified: true });
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: conversationId } = await params;

  let typing: boolean;
  try {
    const body = (await req.json()) as { typing?: unknown };
    typing = body.typing === true;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const db = createServiceClient();

  const [limitResult, access, senderResult] = await Promise.all([
    rateLimit(`dm:typing:${userId}:10s`, 8, 10),
    loadDmConversationForUser(db, conversationId, userId),
    db.from("users").select("name").eq("id", userId).maybeSingle(),
  ]);
  if (!limitResult.success) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const name = (senderResult.data as { name?: string } | null)?.name ?? "Someone";

  after(async () => {
    try {
      await publishDmEvent({
        participants: dmParticipants(access.conversation),
        topic: "dm-typing",
        data: {
          conversation_id: conversationId,
          user_id: userId,
          name,
          typing,
          ts: Date.now(),
        },
      });
    } catch (err) {
      console.error("[POST dm typing] realtime publish error:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
