import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const STATUSES = new Set(["approved", "review", "rejected"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { status, moderator_notes, ban_user } = body as {
    status?: string;
    moderator_notes?: string;
    ban_user?: boolean;
  };

  const patch: { status?: string; moderator_notes?: string | null } = {};
  if (typeof status === "string") {
    if (!STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid moderation status." }, { status: 422 });
    }
    patch.status = status;
  }
  if (typeof moderator_notes === "string") patch.moderator_notes = moderator_notes.trim() || null;

  if (!Object.keys(patch).length && ban_user !== true) {
    return NextResponse.json({ error: "No moderation action provided." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data: event } = await db.from("moderation_events").select("id, user_id").eq("id", id).maybeSingle();
  if (!event) return NextResponse.json({ error: "Moderation event not found." }, { status: 404 });

  if (Object.keys(patch).length) {
    const { error } = await db.from("moderation_events").update(patch).eq("id", id);
    if (error) {
      console.error("[admin/moderation] PATCH error:", error);
      return NextResponse.json({ error: "Failed to update moderation event." }, { status: 500 });
    }
  }

  if (ban_user === true && event.user_id) {
    const { error } = await db.from("users").update({ is_blocked: true }).eq("id", event.user_id);
    if (error) {
      console.error("[admin/moderation] ban user error:", error);
      return NextResponse.json({ error: "Failed to ban user." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const db = createServiceClient();
  const { error } = await db.from("moderation_events").delete().eq("id", id);

  if (error) {
    console.error("[admin/moderation] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete moderation event." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
