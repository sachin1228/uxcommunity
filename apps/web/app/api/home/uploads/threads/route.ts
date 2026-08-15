import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { uploadToR2 } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_TYPES = new Set([
  ...IMAGE_TYPES,
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "text/plain",
]);

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
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "This file type is not supported." }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Files must be 10 MB or smaller." }, { status: 422 });
  }

  const slug = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const isImage = IMAGE_TYPES.has(file.type);

  try {
    let body: Buffer;
    let contentType: string;
    let storedSize: number;
    let key: string;

    if (isImage) {
      // Images are compressed client-side; store the moderated bytes as-is.
      body = Buffer.from(await file.arrayBuffer());
      contentType = file.type;
      storedSize = body.length;
      key = `threads/public/${session.userId}/${slug}.${extensionForMime(file.type)}`;
    } else {
      body = Buffer.from(await file.arrayBuffer());
      contentType = file.type;
      storedSize = file.size;
      const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      key = `threads/public/${session.userId}/${slug}.${extension}`;
    }

    const url = await uploadToR2(key, body, contentType);
    return NextResponse.json(
      { attachment: { name: file.name, url, type: contentType, size: storedSize } },
      { status: 201 },
    );
  } catch (error) {
    console.error("[public thread upload]", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}