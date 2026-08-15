import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { uploadToR2 } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }

  let form: FormData; try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File) || !TYPES.has(file.type) || file.size > MAX_BYTES) return NextResponse.json({ error: "Choose a JPEG, PNG, or WebP image under 8 MB." }, { status: 422 });
  try {
    const body = Buffer.from(await file.arrayBuffer());
    const key = `showcase/public/${session.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extensionForMime(file.type)}`;
    return NextResponse.json({ url: await uploadToR2(key, body, file.type) }, { status: 201 });
  } catch (error) {
    console.error("[public showcase upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}