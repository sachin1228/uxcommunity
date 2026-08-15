import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

const PAGE_SIZE = 30;

export async function GET() {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const [{ data, error }, { count, error: countError }] = await Promise.all([
    db
      .from("notifications")
      .select(
        "id, user_id, actor_id, community_id, type, entity_type, entity_id, title, body, href, metadata, read_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
    db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);

  if (error || countError) {
    console.error("[GET notifications]", error ?? countError);
    return NextResponse.json({ error: "Failed to load notifications." }, { status: 500 });
  }

  return NextResponse.json({
    notifications: data ?? [],
    unread_count: count ?? 0,
  });
}

export async function PATCH(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  let body: { id?: unknown; all?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const db = createServiceClient();
  const userId = session.userId!;
  const now = new Date().toISOString();

  if (body.all === true) {
    const { data: rows, error } = (await db
      .from("notifications")
      .select("id, user_id, type, title, body, href, read_at, created_at")
      .eq("user_id", userId)
      .is("read_at", null)) as unknown as {
      data: Array<{
        id: string;
        user_id: string;
        type: string;
        title: string;
        body: string | null;
        href: string;
        read_at: string | null;
        created_at: string;
      }> | null;
      error: unknown;
    };

    if (error) {
      console.error("[PATCH notifications all]", error);
      return NextResponse.json({ error: "Failed to mark notifications read." }, { status: 500 });
    }

    if (rows?.length) {
      const { error: updateError } = await db
        .from("notifications")
        .update({ read_at: now })
        .eq("user_id", userId)
        .is("read_at", null);
      if (updateError) {
        console.error("[PATCH notifications all]", updateError);
        return NextResponse.json({ error: "Failed to mark notifications read." }, { status: 500 });
      }

      // Keep other open tabs' bell counts in sync.
      after(() => {
        void publishRealtimeBatch(
          rows.map((row) => ({
            room: realtimeRooms.notifications(userId),
            topic: "update",
            data: {
              next: { ...row, read_at: now },
              old: { id: row.id, read_at: null },
            },
          })),
        );
      });
    }

    return NextResponse.json({ ok: true });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "Notification id is required." }, { status: 422 });
  }

  const { data: row } = (await db
    .from("notifications")
    .select("id, user_id, type, title, body, href, read_at, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      user_id: string;
      type: string;
      title: string;
      body: string | null;
      href: string;
      read_at: string | null;
      created_at: string;
    } | null;
  };

  const { error } = await db
    .from("notifications")
    .update({ read_at: now })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("[PATCH notification]", error);
    return NextResponse.json({ error: "Failed to mark notification read." }, { status: 500 });
  }

  if (row) {
    after(() => {
      void publishRealtimeBatch([
        {
          room: realtimeRooms.notifications(userId),
          topic: "update",
          data: { next: { ...row, read_at: now }, old: { id: row.id, read_at: row.read_at } },
        },
      ]);
    });
  }

  return NextResponse.json({ ok: true });
}
