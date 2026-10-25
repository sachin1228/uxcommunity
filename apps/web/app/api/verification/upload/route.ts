import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { detectImageMime, extensionForMime } from "@/lib/image-utils";
import { deleteFromR2, parseR2Key, uploadToR2 } from "@/lib/r2";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function ownKey(url: string, userId: string): string | null {
  const key = parseR2Key(url);
  if (!key || !key.startsWith(`verification/${userId}/`)) return null;
  return key;
}

/** POST /api/verification/upload — an optional work sample image. */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;
  const rl = await rateLimit(`verification:upload:${userId}`, 30, 3600);
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

  const key = `verification/${userId}/${randomUUID()}.${extensionForMime(mime)}`;
  try {
    const url = await uploadToR2(key, buffer, mime);
    return NextResponse.json({ url });
  } catch (error) {
    console.error("[verification/upload] R2 error:", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}

/** DELETE /api/verification/upload?url=… — remove a sample before submitting. */
export async function DELETE(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const url = request.nextUrl.searchParams.get("url") ?? "";
  const key = ownKey(url, session.userId!);
  if (!key) {
    return NextResponse.json({ error: "Invalid sample." }, { status: 422 });
  }

  try {
    await deleteFromR2(key);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[verification/upload] delete error:", error);
    return NextResponse.json({ error: "Could not remove the sample." }, { status: 500 });
  }
}
