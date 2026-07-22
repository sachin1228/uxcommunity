import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { compressChatImage } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";

const MAX_INPUT_BYTES = 20 * 1024 * 1024; // 20 MB raw upload limit

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;

  // Verify membership
  const db = createServiceClient();
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

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

  if (!ALLOWED_TYPES.has(file.type) && !file.name.match(/\.(jpe?g|png|webp|gif|heic|heif)$/i)) {
    return NextResponse.json({ error: "Only image files are allowed." }, { status: 422 });
  }

  if (file.size > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: "Image must be under 20 MB." }, { status: 422 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let compressed;
  try {
    compressed = await compressChatImage(buffer);
  } catch {
    return NextResponse.json({ error: "Failed to process image." }, { status: 422 });
  }

  const key = `chat/${communityId}/${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;

  try {
    const url = await uploadToR2(key, compressed.data, compressed.contentType);
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    console.error("[chat-image-upload] R2 error:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
