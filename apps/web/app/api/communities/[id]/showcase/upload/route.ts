import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  copyR2Object,
  deleteFromR2,
  headR2Object,
  r2PublicUrl,
  uploadToR2,
  type R2ObjectMetadata,
} from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";
import {
  declaredBodyTooLarge,
  evaluateShowcaseVideoFinalize,
  isShowcasePosterKeyForMedia,
  proxyUploadKind,
  readBoundedBody,
  showcaseFinalPosterKeyForMedia,
  type VideoUploadTicket,
} from "@/lib/video/upload-guard";
import { logEvent } from "@/lib/observability/log";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/communities/[id]/showcase/upload
 *
 * The single entry point for showcase media (images + videos). It has two
 * completely different modes, split by content type:
 *
 *   • JSON — VIDEO finalization. The browser PUT the file straight to R2
 *     against a presigned ticket from /upload-ticket; this mode just
 *     HEAD-verifies the object landed and returns the attachment, so no video
 *     bytes ever reach the Worker.
 *
 *   • multipart/form-data — IMAGE upload (images are small, client-compressed
 *     and validated here before the R2 write).
 *
 * Videos are deliberately NOT accepted as multipart: proxying a 50 MB body
 * would mean holding it in Worker memory. The body is bounded below (and
 * refused outright when it is a video) so that can never happen.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", session.userId!).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member." }, { status: 403 });

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return completeDirectUpload(request, session.userId!, id);
  }

  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Send video metadata as JSON, or an image as multipart/form-data." },
      { status: 415 },
    );
  }

  // Reject a body that already declares itself too big, without reading it.
  if (declaredBodyTooLarge(request.headers.get("content-length"))) {
    return proxyTooLargeResponse();
  }

  // Hard, header-independent memory bound: read at most MAX_PROXY_BODY_BYTES
  // and cancel the rest, so an oversized (or chunked) body can never be
  // buffered whole — a 50 MB video is cut off at the cap instead.
  const bounded = await readBoundedBody(request.body);
  if (!bounded.ok) {
    return bounded.reason === "too_large"
      ? proxyTooLargeResponse()
      : NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await new Response(bounded.bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 422 });

  // Videos are direct-to-R2 only. Refuse them here rather than streaming the
  // bytes through the app and into Worker memory.
  const kind = proxyUploadKind(file.type);
  if (kind === "video") {
    return NextResponse.json(
      { error: "Videos upload directly to storage. Refresh the page and try again." },
      { status: 422 },
    );
  }
  if (kind !== "image") {
    return NextResponse.json(
      { error: "Choose a JPEG, PNG, WebP, or GIF image." },
      { status: 422 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Images must be 8 MB or smaller." }, { status: 422 });
  }

  const body = Buffer.from(await file.arrayBuffer());
  const extension = extensionForMime(file.type);
  const key = `showcase/${id}/${session.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  try {
    const url = await uploadToR2(key, body, file.type);
    return NextResponse.json(
      { url, attachment: { name: file.name, url, type: file.type, size: file.size } },
      { status: 201 },
    );
  } catch (error) {
    logEvent("error", {
      event: "showcase.upload_failed",
      community_id: id,
      user_id: session.userId,
      error,
    });
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}

function proxyTooLargeResponse() {
  return NextResponse.json(
    { error: "That upload is too large. Videos upload directly to storage." },
    { status: 413 },
  );
}

interface CompleteBody {
  mediaId?: unknown;
  key?: unknown;
  name?: unknown;
  type?: unknown;
  size?: unknown;
  posterUrl?: unknown;
}

function finalizeRejectionStatus(reason: string): number {
  if (reason === "not_owner") return 403;
  if (reason === "ticket_missing") return 422;
  if (reason === "already_finalized") return 409;
  if (reason === "expired") return 410;
  return 422;
}

/**
 * VIDEO finalization: the bytes are already in R2 (browser PUT against the
 * presigned ticket). The ticket row, not the request body, decides who may
 * finalize and for how long; the R2 HEAD, not the body, decides the real
 * size/type. A verified object is copied to a client-unwritable "finalized"
 * key, so a still-valid staging presign cannot replace the attachment after
 * finalization.
 */
async function completeDirectUpload(
  request: NextRequest,
  sessionUserId: string,
  communityId: string,
) {
  let body: CompleteBody;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 }); }

  const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";
  const key = typeof body.key === "string" ? body.key : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 255) : "video";
  const type = typeof body.type === "string" ? body.type : "";
  const size = typeof body.size === "number" ? Math.round(body.size) : 0;
  if (!mediaId || !key) {
    return NextResponse.json({ error: "Invalid upload reference." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data: row, error: ticketError } = await db
    .from("media_upload_tickets")
    .select(
      "id, media_id, user_id, community_id, staging_key, poster_staging_key, content_type, expected_size, expires_at, finalized_at, rejected_at",
    )
    .eq("media_id", mediaId)
    .maybeSingle();

  if (ticketError) {
    logEvent("error", {
      event: "showcase.video_finalize_ticket_read_failed",
      media_id: mediaId,
      error: ticketError,
    });
    return NextResponse.json({ error: "Could not verify the upload. Try again." }, { status: 500 });
  }

  const ticket: VideoUploadTicket | null = row
    ? {
        mediaId: row.media_id,
        userId: row.user_id,
        communityId: row.community_id,
        stagingKey: row.staging_key,
        posterStagingKey: row.poster_staging_key,
        contentType: row.content_type,
        expectedSize: Number(row.expected_size),
        expiresAt: new Date(row.expires_at).getTime(),
        finalizedAt: row.finalized_at ? new Date(row.finalized_at).getTime() : null,
        rejectedAt: row.rejected_at ? new Date(row.rejected_at).getTime() : null,
      }
    : null;

  let object: R2ObjectMetadata | null = null;
  try {
    object = await headR2Object(key);
  } catch (error) {
    logEvent("error", {
      event: "showcase.video_finalize_head_failed",
      media_id: mediaId,
      error,
    });
    return NextResponse.json({ error: "Could not verify the upload. Try again." }, { status: 500 });
  }

  const decision = evaluateShowcaseVideoFinalize({
    ticket,
    sessionUserId,
    communityId,
    mediaId,
    key,
    type,
    reportedSize: size,
    object,
  });

  if (!decision.ok) {
    // Never delete an object that belongs to another member's ticket.
    const mayClean =
      decision.reason !== "ticket_missing" &&
      decision.reason !== "not_owner" &&
      decision.reason !== "already_finalized";
    if (mayClean && ticket) {
      await Promise.allSettled([
        deleteFromR2(key),
        ...(ticket.posterStagingKey ? [deleteFromR2(ticket.posterStagingKey)] : []),
      ]);
      await db
        .from("media_upload_tickets")
        .update({ rejected_at: new Date().toISOString() })
        .eq("id", row!.id)
        .is("finalized_at", null);
    }
    logEvent("warn", {
      event: "showcase.video_finalize_rejected",
      media_id: mediaId,
      reason: decision.reason,
    });
    return NextResponse.json(
      { error: "Upload verification failed. Please upload the video again." },
      { status: finalizeRejectionStatus(decision.reason) },
    );
  }

  // Copy before claiming: a failed copy leaves the ticket retryable.
  try {
    await copyR2Object(key, decision.finalKey, type);
  } catch (error) {
    logEvent("error", {
      event: "showcase.video_finalize_copy_failed",
      media_id: mediaId,
      error,
    });
    return NextResponse.json({ error: "Could not finish the upload. Try again." }, { status: 500 });
  }

  let finalPosterUrl: string | undefined;
  if (ticket?.posterStagingKey) {
    const posterKey = ticket.posterStagingKey;
    const posterFinalKey = showcaseFinalPosterKeyForMedia(mediaId);
    try {
      const poster = await headR2Object(posterKey);
      const validPoster =
        poster !== null &&
        poster.contentLength > 0 &&
        poster.contentLength <= MAX_IMAGE_BYTES &&
        (poster.contentType ?? "").split(";")[0].trim().toLowerCase() === "image/jpeg" &&
        isShowcasePosterKeyForMedia(posterKey, mediaId);
      if (validPoster) {
        await copyR2Object(posterKey, posterFinalKey, "image/jpeg");
        finalPosterUrl = r2PublicUrl(posterFinalKey);
      }
    } catch (error) {
      // The poster is decorative; a broken poster must not fail the video.
      logEvent("warn", { event: "showcase.video_finalize_poster_failed", media_id: mediaId, error });
    }
    void deleteFromR2(posterKey).catch(() => {});
  }

  // One winner: a concurrent finalize that read the same unfinalized ticket
  // loses this conditional update and reports a conflict.
  const { data: claimed, error: claimError } = await db
    .from("media_upload_tickets")
    .update({ finalized_at: new Date().toISOString() })
    .eq("id", row!.id)
    .is("finalized_at", null)
    .select("id");

  if (claimError || !claimed?.length) {
    // Another finalize won the claim. Do not delete the shared final key: the
    // winner's (identical, verified) object is now the attachment.
    return NextResponse.json(
      { error: "This upload has already been finalized." },
      { status: 409 },
    );
  }

  void deleteFromR2(key).catch(() => {});

  return NextResponse.json(
    {
      mediaId,
      status: "ready" as const,
      attachment: {
        name,
        url: r2PublicUrl(decision.finalKey),
        type,
        size: object!.contentLength,
        ...(finalPosterUrl ? { poster: finalPosterUrl } : {}),
        mediaId,
        status: "ready" as const,
      },
    },
    { status: 201 },
  );
}
