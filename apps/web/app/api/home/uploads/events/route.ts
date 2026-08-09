import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { uploadToR2 } from "@/lib/r2";
import { compressChatImage } from "@/lib/image-utils";

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 422 });
  }
  if (!IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Only images are supported (JPEG, PNG, WebP, GIF)." }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 5 MB or smaller." }, { status: 422 });
  }

  const slug = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const compressed = await compressChatImage(Buffer.from(await file.arrayBuffer()));
    const url = await uploadToR2(
      `events/public/${session.userId}/${slug}.webp`,
      compressed.data,
      compressed.contentType,
    );
    return NextResponse.json({ url }, { status: 201 });
  } catch (error) {
    console.error("[public event image upload]", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}