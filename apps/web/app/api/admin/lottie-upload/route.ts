import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const BUCKET = "master-data-images";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — Lottie JSON files should be small

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

  // Accept only JSON (Lottie animation files)
  const isJson =
    file.type === "application/json" ||
    file.type === "text/json" ||
    file.name.endsWith(".json");

  if (!isJson) {
    return NextResponse.json(
      { error: "Only .json Lottie animation files are allowed." },
      { status: 422 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Lottie file must be under 2 MB." }, { status: 422 });
  }

  // Validate it's parseable JSON
  try {
    const text = await file.text();
    JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "File is not valid JSON." }, { status: 422 });
  }

  const path = `lottie/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

  const db = createServiceClient();
  const { data, error } = await db.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: "application/json",
      upsert: false,
    });

  if (error) {
    console.error("[lottie-upload] Supabase storage error:", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(data.path);
  return NextResponse.json({ url: publicUrl }, { status: 201 });
}
