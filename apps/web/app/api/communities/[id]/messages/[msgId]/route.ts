import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus, logCommunityActivity } from "@/lib/communities/manager-role";
import { publishChatEvent } from "@/lib/realtime/server";
import { moderateWithLocalTextRules } from "@/lib/moderation/text-rules";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";
import { canEditMessage } from "@/lib/communities/message-edit";

/**
 * PATCH /api/communities/[id]/messages/[msgId]
 *
 * Edits the text of an owned message. Images and reply metadata are kept as-is;
 * the client only exposes this action for messages that contain text.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId, msgId } = await params;

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
  const { data: msg } = (await db
    .from("community_messages")
    .select("id, user_id, created_at, content, deleted_at")
    .eq("id", msgId)
    .eq("community_id", communityId)
    .maybeSingle()) as unknown as {
    data: { id: string; user_id: string; created_at: string; content: string | null; deleted_at: string | null } | null;
  };

  if (!msg) return NextResponse.json({ error: "Message not found." }, { status: 404 });
  if (msg.user_id !== userId) return NextResponse.json({ error: "You can only edit your own messages." }, { status: 403 });
  if (msg.deleted_at) return NextResponse.json({ error: "Deleted messages cannot be edited." }, { status: 409 });
  if (!msg.content) return NextResponse.json({ error: "This message has no editable text." }, { status: 409 });
  if (!canEditMessage(msg.created_at)) {
    return NextResponse.json(
      { error: "Messages can only be edited within 15 minutes of sending." },
      { status: 409 },
    );
  }

  const moderation = moderateWithLocalTextRules({ content, contentType: "chat_message", userId });
  if (!moderation.allowed) {
    await logModerationDecision(db, {
      userId,
      contentType: "chat_message",
      contentRefId: msgId,
      contentHash: contentHash(content),
      decision: moderation,
    });
    return moderationFailureResponse(moderation);
  }

  const editedAt = new Date().toISOString();
  const { error } = await db
    .from("community_messages")
    .update({ content, edited_at: editedAt })
    .eq("id", msgId)
    .eq("community_id", communityId)
    .eq("user_id", userId);

  if (error) {
    console.error("[PATCH message]", error);
    return NextResponse.json({ error: "Failed to edit message." }, { status: 500 });
  }

  after(async () => {
    try {
      await publishChatEvent({
        communityId,
        topic: "message-edit",
        data: { id: msgId, content, edited_at: editedAt },
      });
    } catch (err) {
      console.error("[PATCH message] realtime publish error:", err);
    }
  });

  return NextResponse.json({ id: msgId, content, edited_at: editedAt });
}

/**
 * DELETE /api/communities/[id]/messages/[msgId]
 *
 * Soft-deletes a message for everyone (owner only).
 * Sets deleted_at, clears content and image_url so data does not leak.
 * The realtime event propagates the change to all clients.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId, msgId } = await params;

  const db = createServiceClient();

  // Fetch message and verify ownership
  const { data: msg } = (await db
    .from("community_messages")
    .select("id, user_id, created_at, image_url")
    .eq("id", msgId)
    .eq("community_id", communityId)
    .maybeSingle()) as unknown as {
    data: { id: string; user_id: string; created_at: string; image_url: string | null } | null;
  };

  if (!msg) return NextResponse.json({ error: "Message not found." }, { status: 404 });

  // Anyone may delete their own message; owners and admins holding the
  // "delete messages" permission may moderate any member's message.
  const managerStatus = await loadCommunityManagerStatus(db, communityId, userId);
  if (!managerStatus) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  const isOwn = msg.user_id === userId;
  const canModerate =
    managerStatus.role === "owner" ||
    (managerStatus.role === "admin" && managerStatus.permissions.can_delete_messages);
  if (!isOwn && !canModerate) {
    return NextResponse.json({ error: "You can only delete your own messages." }, { status: 403 });
  }

  const deletedAt = new Date().toISOString();

  // Soft delete: stamp deleted_at, wipe content and image so data doesn't linger
  const { error } = await db
    .from("community_messages")
    .update({
      deleted_at: deletedAt,
      content:    null,
      image_url:  null,
      reply_to_id: null,
    })
    .eq("id", msgId)
    .eq("community_id", communityId);

  if (error) {
    console.error("[DELETE message]", error);
    return NextResponse.json({ error: "Failed to delete message." }, { status: 500 });
  }

  await import("@/lib/r2").then(({ deleteR2AssetIfUnreferenced }) =>
    deleteR2AssetIfUnreferenced(db, msg.image_url, [
      { table: "community_messages", column: "image_url" },
    ])
  );

  // Audit trail for moderation deletions of other members' messages.
  if (!isOwn && canModerate) {
    const { data: actor } = await db.from("users").select("name").eq("id", userId).maybeSingle();
    await logCommunityActivity(db, {
      communityId,
      actorId: userId,
      actorRole: managerStatus.role === "owner" ? "owner" : "admin",
      actorName: actor?.name ?? null,
      action: "message_deleted",
      targetUserId: msg.user_id,
      details: { message_id: msgId },
    });
  }

  // Broadcast the soft-delete to the community chat room.
  after(async () => {
    try {
      await publishChatEvent({
        communityId,
        topic: "message-delete",
        data: { id: msgId, deleted_at: deletedAt },
      });
    } catch (err) {
      console.error("[DELETE message] realtime publish error:", err);
    }
  });

  return NextResponse.json({ success: true });
}

/**
 * GET /api/communities/[id]/messages/[msgId]
 *
 * Lightweight endpoint used by the realtime handler to fetch the reply preview
 * of a parent message that may not be in the local message cache.
 *
 * Returns: { id: string; content: string | null; image_url: string | null; user_name: string }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId, msgId } = await params;

  const db = createServiceClient();

  // Verify calling user is a member of this community.
  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  const { data: msg } = await db
    .from("community_messages")
    .select("id, content, image_url, user_id")
    .eq("id", msgId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!msg) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const { data: user } = await db
    .from("users")
    .select("name")
    .eq("id", msg.user_id)
    .maybeSingle();

  return NextResponse.json({
    id: msg.id,
    content: (msg as any).content ?? null,
    image_url: (msg as any).image_url ?? null,
    user_name: user?.name ?? "Unknown",
  });
}
