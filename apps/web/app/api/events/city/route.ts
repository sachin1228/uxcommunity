import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { normalizeUtcCursor } from "@/lib/communities/read-models";
import { fetchCityEventPhase, loadCityEventViewer } from "@/lib/events/service";

/**
 * GET /api/events/city — the city Events page's pager.
 *
 * The page's first paint comes from its RSC route (both phases in one round
 * trip); this endpoint only serves "Load more" and mirrors the community
 * events list contract: cursor `phase|event_date|id`, `nextCursor` null when
 * the phase runs out. The city is always the viewer's own — the client never
 * names it.
 */
export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }

  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const viewer = await loadCityEventViewer(db, userId);
  if (!viewer) {
    return NextResponse.json({ error: "No city on your profile." }, { status: 422 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor");
  let [rawPhase = "upcoming", eventDate, cursorId] = cursor?.split("|") ?? [];
  if (rawPhase !== "upcoming" && rawPhase !== "past") {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }
  if (eventDate) {
    if (!cursorId) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    // Cloudflare decodes a '+' in a query value as a space, mangling UTC
    // offsets ("…+00:00" → "… 00:00"). Normalize to "Z" before parsing.
    eventDate = normalizeUtcCursor(eventDate) ?? eventDate;
    if (Number.isNaN(Date.parse(eventDate))) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
  }

  // The page's filter row: type (online / in person) and the start-date
  // window it sends as absolute instants (its own timezone's day/week/month
  // boundaries). Both are optional and must stay constant across a paged
  // stream — the client resends them with every cursor.
  const typeParam = req.nextUrl.searchParams.get("type");
  if (typeParam !== null && typeParam !== "online" && typeParam !== "in-person") {
    return NextResponse.json({ error: "Invalid type filter." }, { status: 400 });
  }
  const isOnline = typeParam === "online" ? true : typeParam === "in-person" ? false : null;

  let from = req.nextUrl.searchParams.get("from");
  let to = req.nextUrl.searchParams.get("to");
  if (from) {
    from = normalizeUtcCursor(from) ?? from;
    if (Number.isNaN(Date.parse(from))) {
      return NextResponse.json({ error: "Invalid from date." }, { status: 400 });
    }
  }
  if (to) {
    to = normalizeUtcCursor(to) ?? to;
    if (Number.isNaN(Date.parse(to))) {
      return NextResponse.json({ error: "Invalid to date." }, { status: 400 });
    }
  }

  try {
    const { events, nextCursor } = await fetchCityEventPhase(db, {
      cityId: viewer.cityId,
      viewerId: userId,
      phase: rawPhase,
      cursorDate: eventDate ?? null,
      cursorId: cursorId ?? null,
      isOnline,
      from,
      to,
    });
    return NextResponse.json({ events, nextCursor });
  } catch (error) {
    console.error("[GET city events]", error);
    return NextResponse.json({ error: "Failed to fetch events." }, { status: 500 });
  }
}
