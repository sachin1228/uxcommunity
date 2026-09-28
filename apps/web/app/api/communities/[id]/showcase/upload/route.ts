import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { uploadToR2, r2ObjectExists, r2PublicUrl } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";
import { VIDEO_MIME_TYPES, MAX_VIDEO_BYTES } from "@uxcommunity/shared";
import {
  declaredBodyTooLarge,
  isShowcaseVideoKeyForMedia,
  proxyUploadKind,
  readBoundedBody,
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
    return completeDirectUpload(request);
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

/**
 * VIDEO finalization: the bytes are already in R2 (browser PUT against the
 * presigned ticket), so this only verifies the object landed with a sane shape
 * and returns the attachment. No DB row — the attachment lives on the post.
 */
async function completeDirectUpload(request: NextRequest) {
  let body: CompleteBody;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 }); }

  const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";
  const key = typeof body.key === "string" ? body.key : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 255) : "video";
  const type = typeof body.type === "string" ? body.type : "";
  const size = typeof body.size === "number" ? Math.round(body.size) : 0;
  const posterUrl =
    typeof body.posterUrl === "string" && /^https:\/\//.test(body.posterUrl) && body.posterUrl.length <= 2048
      ? body.posterUrl
      : undefined;

  // Ownership binding: the key must be one this app issues AND must have been
  // issued for exactly the media id being finalized — no arbitrary keys, and
  // no finalizing a key that belongs to another upload.
  if (!mediaId || !isShowcaseVideoKeyForMedia(key, mediaId)) {
    return NextResponse.json({ error: "Invalid upload reference." }, { status: 422 });
  }
  if (!VIDEO_MIME_TYPES.has(type)) {
    return NextResponse.json({ error: "Unsupported video type." }, { status: 422 });
  }
  if (!(size > 0) || size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Videos must be 50 MB or smaller." }, { status: 422 });
  }

  try {
    if (!(await r2ObjectExists(key))) {
      return NextResponse.json({ error: "Upload did not reach storage. Try again." }, { status: 409 });
    }
  } catch (error) {
    logEvent("error", {
      event: "showcase.video_finalize_head_failed",
      media_id: mediaId,
      error,
    });
    return NextResponse.json({ error: "Could not verify the upload. Try again." }, { status: 500 });
  }

  return NextResponse.json(
    {
      mediaId,
      status: "ready" as const,
      attachment: {
        name,
        url: r2PublicUrl(key),
        type,
        size,
        ...(posterUrl ? { poster: posterUrl } : {}),
        mediaId,
        status: "ready" as const,
      },
    },
    { status: 201 },
  );
}
