import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { deletePrivateVerificationKeys } from "@/lib/private-storage-cleanup";
import { detectImageMime, extensionForMime } from "@/lib/image-utils";
import { deleteFromR2 } from "@/lib/r2";
import {
  isOwnVerificationKey,
  isPrivateStorageConfigured,
  legacyPrivateKeyFromUrl,
  privateVerificationKey,
  signPrivateGet,
  uploadPrivateToR2,
} from "@/lib/r2-private";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** The preview only has to outlive the form session; it is never persisted. */
const PREVIEW_TTL_SECONDS = 30 * 60;

/**
 * POST /api/verification/upload — an optional work sample image.
 *
 * The image is written to the private bucket under the member's own prefix and
 * the response carries the object key (for the submit call) plus a short-lived
 * signed URL (for the thumbnail). Neither the object nor a permanent URL is
 * public.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  if (!isPrivateStorageConfigured()) {
    return NextResponse.json({ error: "Private storage is not configured." }, { status: 503 });
  }

  const userId = session.userId!;
  const rl = await rateLimit(`verification:upload:${userId}`, 30, 3600, { failClosed: true });
  if (!rl.success) {
    return NextResponse.json({ error: "Too many uploads. Try again later." }, { status: 429 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "An image upload is required." }, { status: 415 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An image is required." }, { status: 422 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG and WebP images are accepted." }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Each sample must be under 5 MB." }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = detectImageMime(buffer);
  if (!mime) {
    return NextResponse.json({ error: "That file is not a valid JPEG, PNG or WebP image." }, { status: 422 });
  }

  const key = privateVerificationKey(userId, extensionForMime(mime));
  try {
    await uploadPrivateToR2(key, buffer, mime);
    const url = await signPrivateGet(key, { expiresInSeconds: PREVIEW_TTL_SECONDS });
    return NextResponse.json({ key, url, expiresIn: PREVIEW_TTL_SECONDS });
  } catch (error) {
    console.error("[verification/upload] private R2 error:", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}

/**
 * DELETE /api/verification/upload?key=… — remove a sample before submitting.
 * The legacy `?url=` form is still accepted for a client that cached an old
 * public object; the key is scoped to the session member in both cases.
 */
export async function DELETE(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (key) {
    if (!isOwnVerificationKey(key, userId)) {
      return NextResponse.json({ error: "Invalid sample." }, { status: 422 });
    }
    try {
      // A prefilled sample from an earlier request is still referenced by that
      // request's keys; removing it from this form must not break the history.
      const db = createServiceClient();
      await deletePrivateVerificationKeys(db, [key]);
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("[verification/upload] private delete error:", error);
      return NextResponse.json({ error: "Could not remove the sample." }, { status: 500 });
    }
  }

  const url = request.nextUrl.searchParams.get("url") ?? "";
  const legacyKey = legacyPrivateKeyFromUrl(url);
  if (!legacyKey || !legacyKey.startsWith(`verification/${userId}/`)) {
    return NextResponse.json({ error: "Invalid sample." }, { status: 422 });
  }

  try {
    await deleteFromR2(legacyKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[verification/upload] legacy delete error:", error);
    return NextResponse.json({ error: "Could not remove the sample." }, { status: 500 });
  }
}
