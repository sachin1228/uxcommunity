import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string; eventId: string; commentId: string }> };

export async function DELETE(
  _req: NextRequest,
  { params }: Params,
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { eventId, commentId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const { data: existing } = await db
    .from("event_comments")
    .select("id, user_id")
    .eq("id", commentId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "Not your comment." }, { status: 403 });

  const { error } = await db.from("event_comments").delete().eq("id", commentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
