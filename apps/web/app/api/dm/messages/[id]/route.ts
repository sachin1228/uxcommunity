import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient, type ServiceClient } from "@/lib/supabase/service";
import { canEditMessage } from "@/lib/communities/message-edit";
import { dmParticipants } from "@/lib/direct-messages/server";
import { publishDmEvent } from "@/lib/direct-messages/publish";

interface MessageWithConversation {
  id: string;
  conversation_id: string;
  user_id: string;
  created_at: string;
  content: string | null;
  image_url: string | null;
  deleted_at: string | null;
  dm_conversations: { user_a: string; user_b: string } | null;
}

/**
 * Load a DM message together with its conversation pair, then authorize the
 * caller as a participant. 404 when the message is gone, 403 when the caller
 * is not in its conversation.
 */
async function loadMessageForUser(
  db: ServiceClient,
  messageId: string,
  userId: string,
): Promise<{ ok: true; message: MessageWithConversation } | { ok: false; status: 403 | 404 }> {
  const { data } = (await db
    .from("dm_messages")
    .select(
      "id, conversation_id, user_id, created_at, content, image_url, deleted_at, dm_conversations(user_a, user_b)",
    )
    .eq("id", messageId)
    .maybeSingle()) as unknown as { data: MessageWithConversation | null };

  if (!data) return { ok: false, status: 404 };
  const conversation = data.dm_conversations;
  if (!conversation || (conversation.user_a !== userId && conversation.user_b !== userId)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, message: data };
}

/**
 * PATCH /api/dm/messages/[id]
 *
 * Edit the text of an owned message. Images and reply metadata are kept as-is
 * (the client only offers this action for messages that contain text), within
 * the same 15-minute window as the community chat.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: messageId } = await params;

  let content: string;
  try {
    const body = await req.json();
    content = typeof body.content === "string" ? body.content.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!content) return NextResponse.json({ error: "Message cannot be empty." }, { status: 422 });
  if (content.length > 2000) return NextResponse.json({ error: "Message too long." }, { status: 422 });

  const db = createServiceClient();
  const loaded = await loadMessageForUser(db, messageId, userId);
  if (!loaded.ok) {
    return loaded.status === 404
      ? NextResponse.json({ error: "Message not found." }, { status: 404 })
      : NextResponse.json({ error: "You are not part of this conversation." }, { status: 403 });
  }
  const msg = loaded.message;

  if (msg.user_id !== userId) return NextResponse.json({ error: "You can only edit your own messages." }, { status: 403 });
  if (msg.deleted_at) return NextResponse.json({ error: "Deleted messages cannot be edited." }, { status: 409 });
  if (!msg.content) return NextResponse.json({ error: "This message has no editable text." }, { status: 409 });
  if (!canEditMessage(msg.created_at)) {
    return NextResponse.json(
      { error: "Messages can only be edited within 15 minutes of sending." },
      { status: 409 },
    );
  }

  const editedAt = new Date().toISOString();
  const { error } = await db
    .from("dm_messages")
    .update({ content, edited_at: editedAt })
    .eq("id", messageId)
    .eq("user_id", userId);

  if (error) {
    console.error("[PATCH dm message]", error);
    return NextResponse.json({ error: "Failed to edit message." }, { status: 500 });
  }

  after(async () => {
    try {
      await publishDmEvent({
        participants: dmParticipants(msg.dm_conversations!),
        topic: "dm-message-edit",
        data: { conversation_id: msg.conversation_id, id: messageId, content, edited_at: editedAt },
      });
    } catch (err) {
      console.error("[PATCH dm message] realtime publish error:", err);
    }
  });

  return NextResponse.json({ id: messageId, content, edited_at: editedAt });
}

/**
 * DELETE /api/dm/messages/[id]
 *
 * Soft-delete the caller's own message for both participants. There is no
 * moderation in a 1:1 conversation — the author is the only one who may
 * delete. Content and image are wiped so data does not linger in the row.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: messageId } = await params;

  const db = createServiceClient();
  const loaded = await loadMessageForUser(db, messageId, userId);
  if (!loaded.ok) {
    return loaded.status === 404
      ? NextResponse.json({ error: "Message not found." }, { status: 404 })
      : NextResponse.json({ error: "You are not part of this conversation." }, { status: 403 });
  }
  const msg = loaded.message;

  if (msg.user_id !== userId) {
    return NextResponse.json({ error: "You can only delete your own messages." }, { status: 403 });
  }

  const deletedAt = new Date().toISOString();
  const { error } = await db
    .from("dm_messages")
    .update({
      deleted_at: deletedAt,
      content: null,
      image_url: null,
      reply_to_id: null,
    })
    .eq("id", messageId)
    .eq("user_id", userId);

  if (error) {
    console.error("[DELETE dm message]", error);
    return NextResponse.json({ error: "Failed to delete message." }, { status: 500 });
  }

  await import("@/lib/r2").then(({ deleteR2AssetIfUnreferenced }) =>
    deleteR2AssetIfUnreferenced(db, msg.image_url, [
      { table: "dm_messages", column: "image_url" },
    ])
  );

  after(async () => {
    try {
      await publishDmEvent({
        participants: dmParticipants(msg.dm_conversations!),
        topic: "dm-message-delete",
        data: { conversation_id: msg.conversation_id, id: messageId, deleted_at: deletedAt },
      });
    } catch (err) {
      console.error("[DELETE dm message] realtime publish error:", err);
    }
  });

  return NextResponse.json({ success: true });
}

/**
 * GET /api/dm/messages/[id]
 *
 * Reply-preview lookup for a parent message that is not in the local cache
 * (same contract as the community chat's message GET).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: messageId } = await params;

  const db = createServiceClient();
  const loaded = await loadMessageForUser(db, messageId, userId);
  if (!loaded.ok) {
    return loaded.status === 404
      ? NextResponse.json({ error: "Message not found." }, { status: 404 })
      : NextResponse.json({ error: "You are not part of this conversation." }, { status: 403 });
  }
  const msg = loaded.message;

  const { data: user } = await db
    .from("users")
    .select("name")
    .eq("id", msg.user_id)
    .maybeSingle();

  return NextResponse.json({
    id: msg.id,
    content: msg.content ?? null,
    image_url: msg.image_url ?? null,
    user_name: (user as { name?: string } | null)?.name ?? "Unknown",
    user_id: msg.user_id,
  });
}
