import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * GET /api/diary — list the current user's diary entries (newest first).
 * POST /api/diary — create a new diary entry.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;

  const db = createServiceClient() as any;
  const { data, error } = await db
    .from("diary_entries")
    .select("id, title, content, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/diary] Supabase error:", error);
    return NextResponse.json({ error: "Failed to load diary." }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: Request) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;

  let title = "";
  let content = "";
  try {
    const body = await req.json();
    title = typeof body.title === "string" ? body.title.trim() : "";
    content = typeof body.content === "string" ? body.content.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ error: "Write something before saving." }, { status: 422 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: "Title is too long." }, { status: 422 });
  }
  if (content.length > 20000) {
    return NextResponse.json({ error: "Entry is too long." }, { status: 422 });
  }

  const db = createServiceClient() as any;
  const { data, error } = await db
    .from("diary_entries")
    .insert({ user_id: userId, title, content })
    .select("id, title, content, created_at, updated_at")
    .single();

  if (error || !data) {
    console.error("[POST /api/diary] Supabase error:", error);
    return NextResponse.json({ error: "Failed to save entry." }, { status: 500 });
  }

  return NextResponse.json({ entry: data }, { status: 201 });
}
