import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { compressChatImage } from "@/lib/image-utils";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";
import { detectImageMime, moderateImageBuffer } from "@/lib/moderation/image";
import { logModerationDecision } from "@/lib/moderation/log";
import { createServerTimer } from "@/lib/server-timing";
import { getMembershipCached } from "@/lib/communities/membership-cache";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_CONTENT_LENGTH = 2000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ImageStatus = "approved" | "rejected" | "review_required";

function terminalStatus(status: "approved" | "review" | "rejected"): ImageStatus {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return "review_required";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = createServerTimer("POST /api/communities/[id]/messages/upload");
  const finish = (response: Response) => {
    timer.finish({ status: response.status });
    return response;
  };

  let session;
  try {
    session = await timer.measure("auth", () =>
      requireSession("user", {
        onLivenessCache: (state) => {
          timer.record("auth_cache_hit", state === "hit" ? 1 : 0);
          timer.record("auth_cache_dedup", state === "dedup" ? 1 : 0);
        },
      }),
    );
  } catch (error) {
    return finish(error as Response);
  }

  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();
  let membership;
  try {
    membership = await timer.measure("membership_query", () =>
      getMembershipCached(communityId, userId, async () => {
        const { data, error } = await db
          .from("community_members")
          .select("joined_at")
          .eq("community_id", communityId)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        return Boolean(data);
      }),
    );
  } catch {
    return finish(NextResponse.json({ error: "Failed to verify community membership." }, { status: 500 }));
  }

  timer.record("membership_cache_hit", membership.status === "hit" ? 1 : 0);
  timer.record("membership_cache_dedup", membership.status === "dedup" ? 1 : 0);
  if (!membership.isMember) {
    return finish(NextResponse.json({ error: "Not a member of this community." }, { status: 403 }));
  }

  let formData: FormData;
  try {
    formData = await timer.measure("form_parse", () => request.formData());
  } catch {
    return finish(NextResponse.json({ error: "Invalid form data." }, { status: 400 }));
  }

  const file = formData.get("file");
  const content = String(formData.get("content") ?? "").trim();
  let replyToId = String(formData.get("reply_to_id") ?? "").trim() || null;

  if (!(file instanceof File)) {
    return finish(NextResponse.json({ error: "No file provided." }, { status: 400 }));
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return finish(NextResponse.json({ error: "Message too long." }, { status: 422 }));
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return finish(NextResponse.json({ error: "Only JPEG, PNG and WebP images are allowed." }, { status: 422 }));
  }
  if (file.size > MAX_INPUT_BYTES) {
    return finish(NextResponse.json({ error: "Image must be under 20 MB." }, { status: 422 }));
  }

  let source: Buffer;
  try {
    source = await timer.measure("file_decode", async () => Buffer.from(await file.arrayBuffer()));
  } catch {
    return finish(NextResponse.json({ error: "Failed to read image." }, { status: 422 }));
  }

  timer.record("input_bytes", source.byteLength);

  if (detectImageMime(source) !== file.type) {
    return finish(NextResponse.json({ error: "Image bytes do not match the selected file type." }, { status: 422 }));
  }

  if (replyToId) {
    const { data: parent } = await db
      .from("community_messages")
      .select("id")
      .eq("id", replyToId)
      .eq("community_id", communityId)
      .maybeSingle();
    if (!parent) replyToId = null;
  }

  const compression = await timer.measure("compression", () => compressChatImage(source).catch(() => null));
  if (!compression) {
    return finish(NextResponse.json({ error: "Failed to process image." }, { status: 422 }));
  }

  timer.record("compressed_bytes", compression.data.byteLength);
  timer.record("r2_upload_bytes", compression.data.byteLength);

  const key = `chat/${communityId}/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
  let url: string;
  try {
    url = await timer.measure("r2_upload", () => uploadToR2(key, compression.data, compression.contentType));
  } catch (error) {
    console.error("[chat-image-upload] R2 error:", error);
    return finish(NextResponse.json({ error: "Upload failed." }, { status: 500 }));
  }

  const { data: inserted, error: insertError } = await timer.measure("message_insert", async () =>
    await db
      .from("community_messages")
      .insert({
        community_id: communityId,
        user_id: userId,
        content: content || null,
        reply_to_id: replyToId,
        image_url: url,
        image_status: "pending",
      })
      .select("id, content, created_at, user_id, reply_to_id, image_url, image_status")
      .single(),
  );

  if (insertError || !inserted) {
    await deleteFromR2(key).catch((cleanupError) =>
      console.error("[chat-image-upload] insert cleanup failed:", cleanupError),
    );
    console.error("[chat-image-upload] message insert failed:", insertError);
    return finish(NextResponse.json({ error: "Failed to send message." }, { status: 500 }));
  }

  const messageId = inserted.id;
  after(async () => {
    const moderationDb = createServiceClient();
    try {
      const result = await moderateImageBuffer(source, file.type);
      const imageStatus = terminalStatus(result.decision.status);
      const moderatedAt = new Date().toISOString();
      const moderationError = imageStatus === "review_required" ? result.decision.reason : null;

      if (imageStatus === "approved") {
        await moderationDb
          .from("community_messages")
          .update({ image_status: imageStatus, image_moderated_at: moderatedAt, image_moderation_error: null })
          .eq("id", messageId)
          .eq("user_id", userId);
      } else {
        const { error: updateError } = await moderationDb
          .from("community_messages")
          .update({
            image_status: imageStatus,
            image_url: null,
            image_moderated_at: moderatedAt,
            image_moderation_error: moderationError,
          })
          .eq("id", messageId)
          .eq("user_id", userId);
        if (!updateError) await deleteFromR2(key).catch(() => {});
      }

      await logModerationDecision(moderationDb, {
        userId,
        contentType: "image_upload",
        contentRefId: messageId,
        decision: result.decision,
      });
    } catch (error) {
      console.error("[chat-image-upload] deferred moderation failed:", error);
      await moderationDb
        .from("community_messages")
        .update({
          image_status: "review_required",
          image_url: null,
          image_moderated_at: new Date().toISOString(),
          image_moderation_error: "Image moderation failed.",
        })
        .eq("id", messageId)
        .eq("user_id", userId);
      await deleteFromR2(key).catch(() => {});
    }
  });

  return finish(
    NextResponse.json(
      {
        message: {
          ...inserted,
          users: null,
          reactions: [],
          reply_to: null,
        },
      },
      { status: 201 },
    ),
  );
}
