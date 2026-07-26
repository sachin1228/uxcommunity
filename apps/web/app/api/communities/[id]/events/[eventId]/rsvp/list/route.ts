import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try { await requireSession("user"); } catch (e) { return e as Response; }

  const { eventId } = await params;
  const db = createServiceClient();

  const { data: rsvps } = await db
    .from("event_rsvps")
    .select("event_id, user_id, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (!rsvps?.length) return NextResponse.json({ rsvps: [] });

  const userIds = rsvps.map((r) => r.user_id);
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);

  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  const enriched = rsvps.map((r) => ({
    ...r,
    users: nameMap[r.user_id] ? { name: nameMap[r.user_id], avatar_url: avatarMap[r.user_id] ?? null } : null,
  }));

  return NextResponse.json({ rsvps: enriched });
}
