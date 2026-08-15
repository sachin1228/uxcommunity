import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { uploadToR2 } from "@/lib/r2";
import { extensionForMime } from "@/lib/image-utils";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session; try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", id).eq("user_id", session.userId!).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member." }, { status: 403 });
  let form: FormData; try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File) || !TYPES.has(file.type) || file.size > MAX_BYTES) return NextResponse.json({ error: "Choose a JPEG, PNG, or WebP image under 8 MB." }, { status: 422 });
  try {
    const body = Buffer.from(await file.arrayBuffer());
    const key = `showcase/${id}/${session.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extensionForMime(file.type)}`;
    return NextResponse.json({ url: await uploadToR2(key, body, file.type) }, { status: 201 });
  } catch (error) {
    console.error("[showcase upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
