import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  dmParticipants,
  loadDmConversationForUser,
  normalizeDmRequestState,
} from "@/lib/direct-messages/server";
import { publishDmEvent } from "@/lib/direct-messages/publish";

/**
 * POST /api/dm/conversations/[id]/request  { action: "accept" | "reject" }
 *
 * The recipient's answer to a pending message request. Only the member who
 * did NOT send the first message may answer. Accept unlocks both composers;
 * reject closes the conversation for both sides (it leaves both lists).
 * Both transitions are idempotent — a double-tap lands on the same state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: conversationId } = await params;

  let action: "accept" | "reject";
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "accept" || body?.action === "reject") {
    action = body.action;
  } else {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const db = createServiceClient();
  const [limitResult, access] = await Promise.all([
    rateLimit(`dm:request:${userId}:60s`, 30, 60),
    loadDmConversationForUser(db, conversationId, userId),
  ]);
  if (!limitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limitResult.resetAt - Date.now()) / 1000)) } },
    );
  }
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const conversation = access.conversation;
  const requester = conversation.requested_by;
  if (!requester) {
    return NextResponse.json(
      { error: "No request is waiting for an answer." },
      { status: 409 },
    );
  }
  if (requester === userId) {
    return NextResponse.json(
      { error: "Only the recipient can answer this request." },
      { status: 403 },
    );
  }

  const currentState = normalizeDmRequestState(conversation.request_state);
  const nextState = action === "accept" ? "accepted" : "rejected";
  if (currentState === nextState) {
    // Already answered — idempotent no-op.
    return NextResponse.json({ request_state: currentState, requested_by: requester });
  }
  if (currentState !== "pending") {
    return NextResponse.json(
      {
        error:
          action === "accept"
            ? "This request was already declined."
            : "This request was already accepted.",
      },
      { status: 409 },
    );
  }

  // Conditional on `pending` so two devices answering at once settle on the
  // first answer; the loser re-reads and reports what actually stands.
  const { data: updated } = (await db
    .from("dm_conversations")
    .update({ request_state: nextState })
    .eq("id", conversationId)
    .eq("request_state", "pending")
    .select("request_state, requested_by")
    .maybeSingle()) as unknown as {
    data: { request_state: string; requested_by: string | null } | null;
  };

  let settled = updated;
  if (!settled) {
    const { data } = (await db
      .from("dm_conversations")
      .select("request_state, requested_by")
      .eq("id", conversationId)
      .maybeSingle()) as unknown as {
      data: { request_state: string; requested_by: string | null } | null;
    };
    settled = data;
  }
  const finalState = normalizeDmRequestState(settled?.request_state);
  const finalRequester = settled?.requested_by ?? requester;

  if (finalState !== currentState) {
    after(async () => {
      try {
        await publishDmEvent({
          participants: dmParticipants(conversation),
          topic: "dm-request-update",
          data: {
            conversation_id: conversationId,
            request_state: finalState,
            requested_by: finalRequester,
          },
        });
      } catch (err) {
        console.error("[POST dm request] realtime publish error:", err);
      }
    });
  }

  return NextResponse.json({ request_state: finalState, requested_by: finalRequester });
}
