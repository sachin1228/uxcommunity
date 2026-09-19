import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { uploadToR2 } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/competitions/upload
 *
 * Stores one competition image (cover, main design, or an extra shot) in the
 * same R2 media bucket every other upload in the app uses, under a
 * competition-scoped, per-member, versioned key.
 *
 * Images take the proxy path (bytes through the app) exactly like showcase
 * images: they are small, the client compresses them first, and the response
 * URL is what the entry body stores.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;
  const limit = await rateLimit(`competition:upload:${userId}:60s`, 20, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many uploads. Try again shortly." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 422 });

  if (!IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Choose a JPEG, PNG, WebP, or GIF image." },
      { status: 422 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Images must be 8 MB or smaller." }, { status: 422 });
  }

  const slugRaw = typeof form.get("slug") === "string" ? (form.get("slug") as string) : "competition";
  const slug = slugRaw.toLowerCase().replace(/[^a-z0-9-]+/g, "").slice(0, 80) || "competition";
  const extension = extensionForMime(file.type);
  const key = `competitions/${slug}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

  try {
    const url = await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json(
      {
        url,
        image: { name: file.name, url, type: file.type, size: file.size },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[competitions upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
