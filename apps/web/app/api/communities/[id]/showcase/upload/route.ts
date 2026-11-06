import { NextRequest, NextResponse, after } from "next/server";
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
  copiedObjectMatches,
  declaredBodyTooLarge,
  evaluateShowcaseVideoFinalize,
  isShowcasePosterKeyForMedia,
  isShowcaseVideoKeyForMedia,
  proxyUploadKind,
  finalizeCleanup,
  readBoundedBody,
  resolveFinalizeCommit,
  showcaseFinalPosterKeyForClaim,
  showcaseFinalVideoKeyForClaim,
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

type TicketRow = {
  id: string;
  media_id: string;
  user_id: string;
  community_id: string;
  staging_key: string;
  poster_staging_key: string | null;
  content_type: string;
  expected_size: number;
  expires_at: string;
  finalized_at: string | null;
  rejected_at: string | null;
  claim_token: string | null;
  final_key: string | null;
  final_poster_key: string | null;
  final_size: number | null;
};

function ticketFromRow(row: TicketRow): VideoUploadTicket {
  return {
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
  };
}

function finalizedAttachment(
  mediaId: string,
  name: string,
  row: TicketRow,
) {
  const finalKey = row.final_key;
  if (!finalKey) return null;
  return {
    mediaId,
    status: "ready" as const,
    attachment: {
      name,
      url: r2PublicUrl(finalKey),
      type: row.content_type,
      size: Number(row.final_size ?? row.expected_size),
      ...(row.final_poster_key ? { poster: r2PublicUrl(row.final_poster_key) } : {}),
      mediaId,
      status: "ready" as const,
    },
  };
}

async function loadTicket(
  db: ReturnType<typeof createServiceClient>,
  mediaId: string,
): Promise<TicketRow | null> {
  const { data, error } = await db
    .from("media_upload_tickets")
    .select(
      "id, media_id, user_id, community_id, staging_key, poster_staging_key, content_type, expected_size, expires_at, finalized_at, rejected_at, claim_token, final_key, final_poster_key, final_size",
    )
    .eq("media_id", mediaId)
    .maybeSingle();
  if (error) throw error;
  return (data as TicketRow | null) ?? null;
}

async function releaseTicket(
  db: ReturnType<typeof createServiceClient>,
  mediaId: string,
  claimToken: string,
  reason: string,
): Promise<void> {
  const { error } = await db.rpc("release_media_upload_ticket", {
    p_media_id: mediaId,
    p_claim_token: claimToken,
    p_error: reason,
  });
  if (error) {
    logEvent("warn", {
      event: "showcase.video_finalize_release_failed",
      media_id: mediaId,
      error,
    });
  }
}

async function rejectTicket(
  db: ReturnType<typeof createServiceClient>,
  mediaId: string,
  claimToken: string,
  reason: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("reject_media_upload_ticket", {
    p_media_id: mediaId,
    p_claim_token: claimToken,
    p_error: reason,
  });
  if (error || data !== true) {
    logEvent("warn", {
      event: "showcase.video_finalize_reject_failed",
      media_id: mediaId,
      error: error ?? "claim_lost",
    });
    return false;
  }
  return true;
}

async function deleteStagingObjects(
  key: string,
  posterKey: string | null,
): Promise<void> {
  await Promise.allSettled([
    deleteFromR2(key),
    ...(posterKey ? [deleteFromR2(posterKey)] : []),
  ]);
}

/**
 * VIDEO finalization: the bytes are already in R2 (browser PUT against the
 * presigned ticket).
 *
 * Concurrency contract:
 *   1. one finalize claims the ticket atomically; a second gets 409 (or, after
 *      the winner commits, the same finalized attachment);
 *   2. the winner HEADs staging, then copies with the staging ETag and HEADs
 *      the copy — the copy must be byte-identical before it can be committed;
 *   3. the canonical key includes the claim token, so a stale/losing claimant
 *      copies to a different key and can never overwrite the winner;
 *   4. the final key is never presigned, so a still-valid staging PUT cannot
 *      replace it.
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
  let row: TicketRow | null;
  try {
    row = await loadTicket(db, mediaId);
  } catch (error) {
    logEvent("error", {
      event: "showcase.video_finalize_ticket_read_failed",
      media_id: mediaId,
      error,
    });
    return NextResponse.json({ error: "Could not verify the upload. Try again." }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: "Invalid upload reference." }, { status: 422 });
  }
  if (row.user_id !== sessionUserId || row.community_id !== communityId) {
    return NextResponse.json({ error: "Upload verification failed." }, { status: 403 });
  }
  if (row.finalized_at) {
    // A committed ticket is terminal; a retry can safely clean staging if the
    // original request crashed before its post-commit cleanup.
    after(() => deleteStagingObjects(row.staging_key, row.poster_staging_key));
    const existing = finalizedAttachment(mediaId, name, row);
    return existing
      ? NextResponse.json(existing, { status: 200 })
      : NextResponse.json({ error: "Upload verification failed." }, { status: 409 });
  }
  if (row.rejected_at) {
    after(() => deleteStagingObjects(row.staging_key, row.poster_staging_key));
    return NextResponse.json(
      { error: "Upload verification failed. Please upload the video again." },
      { status: 410 },
    );
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    // Do not touch staging if a pre-expiry claim is still processing it.
    if (!row.claim_token) {
      after(() => deleteStagingObjects(row.staging_key, row.poster_staging_key));
    }
    return NextResponse.json(
      { error: "Upload verification expired. Please upload the video again." },
      { status: 410 },
    );
  }

  const claimToken = crypto.randomUUID();
  const { data: claimedRows, error: claimError } = await db.rpc(
    "claim_media_upload_ticket",
    {
      p_media_id: mediaId,
      p_user_id: sessionUserId,
      p_community_id: communityId,
      p_claim_token: claimToken,
      p_lease_seconds: 120,
    },
  );

  if (claimError) {
    logEvent("error", {
      event: "showcase.video_finalize_claim_failed",
      media_id: mediaId,
      error: claimError,
    });
    return NextResponse.json({ error: "Could not verify the upload. Try again." }, { status: 500 });
  }

  const claimed = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
  if (!claimed) {
    // Re-read for an accurate outcome: finalized (idempotent result), rejected,
    // expired, or another finalize currently holds the claim.
    const current = await loadTicket(db, mediaId).catch(() => null);
    if (current?.finalized_at) {
      const existing = finalizedAttachment(mediaId, name, current);
      return existing
        ? NextResponse.json(existing, { status: 200 })
        : NextResponse.json({ error: "Upload verification failed." }, { status: 409 });
    }
    if (current?.rejected_at) {
      return NextResponse.json(
        { error: "Upload verification failed. Please upload the video again." },
        { status: 410 },
      );
    }
    return NextResponse.json(
      { error: "This upload is already being finalized. Retry in a moment." },
      { status: 409 },
    );
  }

  const ticket = ticketFromRow(claimed as TicketRow);
  if (
    ticket.mediaId.toLowerCase() !== mediaId.trim().toLowerCase() ||
    ticket.stagingKey !== key ||
    !isShowcaseVideoKeyForMedia(key, mediaId)
  ) {
    await rejectTicket(db, mediaId, claimToken, "reference_mismatch");
    return NextResponse.json({ error: "Invalid upload reference." }, { status: 422 });
  }

  const finalKey = showcaseFinalVideoKeyForClaim(key, mediaId, claimToken);
  if (!finalKey) {
    await rejectTicket(db, mediaId, claimToken, "reference_mismatch");
    return NextResponse.json({ error: "Invalid upload reference." }, { status: 422 });
  }

  let source: R2ObjectMetadata | null = null;
  try {
    source = await headR2Object(key);
  } catch (error) {
    await releaseTicket(db, mediaId, claimToken, "staging_head_failed");
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
    object: source,
  });

  if (!decision.ok) {
    // Reject first: if the lease was stolen, the object now belongs to the
    // new claimant and this request must not delete its staging bytes.
    const rejected = await rejectTicket(db, mediaId, claimToken, decision.reason);
    if (rejected) {
      await deleteStagingObjects(key, ticket.posterStagingKey);
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

  let copied: R2ObjectMetadata | null = null;
  try {
    // Do not rely on provider-specific conditional-copy headers: the second
    // HEAD on the claim-specific copy is the authoritative exact-bytes check.
    await copyR2Object(key, finalKey, type);
    copied = await headR2Object(finalKey);
  } catch (error) {
    await deleteFromR2(finalKey).catch(() => {});
    await releaseTicket(db, mediaId, claimToken, "staging_copy_failed");
    logEvent("error", {
      event: "showcase.video_finalize_copy_failed",
      media_id: mediaId,
      error,
    });
    return NextResponse.json({ error: "Could not finish the upload. Try again." }, { status: 500 });
  }

  if (!copiedObjectMatches(source!, copied, type, ticket.expectedSize)) {
    // Our claim-scoped copy is safe to delete; staging is only deleted if we
    // still hold the claim and have just rejected it.
    await deleteFromR2(finalKey).catch(() => {});
    const rejected = await rejectTicket(db, mediaId, claimToken, "copied_bytes_mismatch");
    if (rejected) await deleteStagingObjects(key, ticket.posterStagingKey);
    logEvent("warn", {
      event: "showcase.video_finalize_bytes_mismatch",
      media_id: mediaId,
    });
    return NextResponse.json(
      { error: "The uploaded file changed during verification. Please upload it again." },
      { status: 409 },
    );
  }

  let finalPosterKey: string | null = null;
  if (ticket.posterStagingKey) {
    const posterStagingKey = ticket.posterStagingKey;
    try {
      const posterSource = await headR2Object(posterStagingKey);
      if (
        posterSource &&
        posterSource.contentLength > 0 &&
        posterSource.contentLength <= MAX_IMAGE_BYTES &&
        (posterSource.contentType ?? "").split(";")[0].trim().toLowerCase() === "image/jpeg" &&
        isShowcasePosterKeyForMedia(posterStagingKey, mediaId)
      ) {
        const candidatePosterKey = showcaseFinalPosterKeyForClaim(mediaId, claimToken);
        await copyR2Object(posterStagingKey, candidatePosterKey, "image/jpeg");
        const posterCopied = await headR2Object(candidatePosterKey);
        if (copiedObjectMatches(posterSource, posterCopied, "image/jpeg", posterSource.contentLength)) {
          finalPosterKey = candidatePosterKey;
        } else {
          await deleteFromR2(candidatePosterKey).catch(() => {});
        }
      }
    } catch (error) {
      logEvent("warn", { event: "showcase.video_finalize_poster_failed", media_id: mediaId, error });
    }
    // Staging is deleted only after a confirmed commit/rejection; a claim
    // that loses its lease must not delete bytes the new claimant may need.
  }

  const { data: committed, error: commitError } = await db.rpc(
    "commit_media_upload_ticket",
    {
      p_media_id: mediaId,
      p_claim_token: claimToken,
      p_final_key: finalKey,
      p_final_poster_key: finalPosterKey,
      p_final_size: copied!.contentLength,
    },
  );

  if (commitError || committed !== true) {
    // The commit may have landed even when its response was lost. Re-read
    // before deleting anything: if the stored final key is ours, the commit
    // succeeded and this request should return the attachment. Deleting it
    // would leave a finalized ticket pointing at a missing object.
    const current = await loadTicket(db, mediaId).catch(() => null);
    const resolution = resolveFinalizeCommit({
      committed: committed === true,
      commitError,
      current: current
        ? {
            finalizedAt: current.finalized_at
              ? new Date(current.finalized_at).getTime()
              : null,
            finalKey: current.final_key,
          }
        : null,
      finalKey,
    });

    if (resolution !== "retry") {
      const cleanup = finalizeCleanup(
        resolution === "finalized_ours" ? "finalized_ours" : "finalized_other",
      );
      if (cleanup.deleteClaimFinal) {
        await deleteFromR2(finalKey).catch(() => {});
        if (finalPosterKey) void deleteFromR2(finalPosterKey).catch(() => {});
      }
      if (cleanup.deleteStaging) {
        await deleteStagingObjects(key, ticket.posterStagingKey);
      }
      const existing = current ? finalizedAttachment(mediaId, name, current) : null;
      return existing
        ? NextResponse.json(existing, { status: 200 })
        : NextResponse.json({ error: "Upload verification failed." }, { status: 409 });
    }

    if (!commitError) {
      // A definitive false: the claim was lost or the ticket was finalized by
      // another request. Delete only this claim's copy; staging may belong to
      // the new claimant.
      const cleanup = finalizeCleanup("claim_lost");
      if (cleanup.deleteClaimFinal) {
        await deleteFromR2(finalKey).catch(() => {});
        if (finalPosterKey) void deleteFromR2(finalPosterKey).catch(() => {});
      }
      await releaseTicket(db, mediaId, claimToken, "commit_lost");
      return NextResponse.json(
        { error: "This upload has already been finalized." },
        { status: 409 },
      );
    }

    // Ambiguous DB failure: leave the claim-scoped object in place. A retry
    // can prove whether the commit landed; deleting now could break a commit
    // whose response was lost. The lease lets a later finalize proceed.
    logEvent("error", {
      event: "showcase.video_finalize_commit_ambiguous",
      media_id: mediaId,
    });
    return NextResponse.json({ error: "Could not finish the upload. Try again." }, { status: 500 });
  }

  const successCleanup = finalizeCleanup("committed");
  if (successCleanup.deleteStaging) {
    await deleteStagingObjects(key, ticket.posterStagingKey);
  }

  return NextResponse.json(
    {
      mediaId,
      status: "ready" as const,
      attachment: {
        name,
        url: r2PublicUrl(finalKey),
        type: ticket.contentType,
        size: copied!.contentLength,
        ...(finalPosterKey ? { poster: r2PublicUrl(finalPosterKey) } : {}),
        mediaId,
        status: "ready" as const,
      },
    },
    { status: 201 },
  );
}
