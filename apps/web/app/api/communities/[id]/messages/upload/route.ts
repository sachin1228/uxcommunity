import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { compressChatImage } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";
import { moderateImageBuffer } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { createServerTimer } from "@/lib/server-timing";

const MAX_INPUT_BYTES = 20 * 1024 * 1024; // 20 MB raw upload limit

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const timer = createServerTimer("POST /api/communities/[id]/messages/upload");
  const finish = (response: Response) => {
    timer.finish({ status: response.status });
    return response;
  };

  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user"));
  } catch (e) {
    return finish(e as Response);
  }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  const { data: membership } = await timer.measure("membership_query", async () =>
    await db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle(),
  );

  if (!membership) {
    return finish(NextResponse.json({ error: "Not a member of this community." }, { status: 403 }));
  }

  let formData: FormData;
  try {
    formData = await timer.measure("form_parse", () => request.formData());
  } catch {
    return finish(NextResponse.json({ error: "Invalid form data." }, { status: 400 }));
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return finish(NextResponse.json({ error: "No file provided." }, { status: 400 }));
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return finish(NextResponse.json({ error: "Only JPEG, PNG and WebP images are allowed." }, { status: 422 }));
  }
  if (file.size > MAX_INPUT_BYTES) {
    return finish(NextResponse.json({ error: "Image must be under 20 MB." }, { status: 422 }));
  }
  timer.record("input_bytes", file.size);

  let source: Buffer;
  try {
    source = await timer.measure("file_decode", async () => Buffer.from(await file.arrayBuffer()));
  } catch {
    return finish(NextResponse.json({ error: "Failed to read image." }, { status: 422 }));
  }

  // Compression is CPU-bound while moderation is a remote request. Running
  // them concurrently removes compression from the critical path, but storage
  // remains strictly gated on an approved moderation decision.
  const [moderation, compression] = await Promise.all([
    timer.measure("moderation_request", () => moderateImageBuffer(source, file.type)),
    timer.measure("compression", () => compressChatImage(source).catch(() => null)),
  ]);

  const moderationDecision = moderation.decision;
  after(async () => {
    try {
      await logModerationDecision(createServiceClient(), {
        userId,
        contentType: "image_upload",
        decision: moderationDecision,
      });
    } catch (error) {
      console.error("[chat-image-upload] deferred moderation audit failed:", error);
    }
  });

  if (!moderation.decision.allowed || !moderation.buffer) {
    return finish(moderationFailureResponse(moderation.decision));
  }
  if (!compression) {
    return finish(NextResponse.json({ error: "Failed to process image." }, { status: 422 }));
  }
  timer.record("output_bytes", compression.data.byteLength);

  const key = `chat/${communityId}/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;

  try {
    const url = await timer.measure("r2_upload", () =>
      uploadToR2(key, compression.data, compression.contentType),
    );
    return finish(NextResponse.json({ url }, { status: 201 }));
  } catch (err) {
    console.error("[chat-image-upload] R2 error:", err);
    return finish(NextResponse.json({ error: "Upload failed." }, { status: 500 }));
  }
}
