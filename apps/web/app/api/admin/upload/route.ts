import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { uploadToR2 } from "@/lib/r2";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

export async function POST(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, WebP and SVG images are allowed." },
      { status: 422 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 422 });
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const key = `master-data/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const url = await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    console.error("[upload] R2 upload error:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
