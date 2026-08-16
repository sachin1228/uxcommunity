import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * PATCH /api/diary/[id]   — update a diary entry.
 * DELETE /api/diary/[id]  — delete a diary entry.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id } = await params;

  let title: string | undefined;
  let content: string | undefined;
  try {
    const body = await req.json();
    if (typeof body.title === "string") title = body.title.trim();
    if (typeof body.content === "string") content = body.content.trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (title === undefined && content === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
  }
  if (title !== undefined && title.length > 200) {
    return NextResponse.json({ error: "Title is too long." }, { status: 422 });
  }
  if (content !== undefined && content.length > 20000) {
    return NextResponse.json({ error: "Entry is too long." }, { status: 422 });
  }

  const db = createServiceClient() as any;
  const update: Record<string, string> = { updated_at: new Date().toISOString() };
  if (title !== undefined) update.title = title;
  if (content !== undefined) update.content = content;

  const { data, error } = await db
    .from("diary_entries")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, title, content, created_at, updated_at")
    .maybeSingle();

  if (error || !data) {
    console.error("[PATCH /api/diary/[id]] Supabase error:", error);
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }

  return NextResponse.json({ entry: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id } = await params;

  const db = createServiceClient() as any;
  const { error } = await db
    .from("diary_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("[DELETE /api/diary/[id]] Supabase error:", error);
    return NextResponse.json({ error: "Failed to delete entry." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
