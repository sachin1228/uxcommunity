import type { SupabaseClient } from "@supabase/supabase-js";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { toUtcCursor } from "@/lib/communities/read-models";
import { enrichEventCards } from "@/lib/communities/event-cards";
import type { CommunityEvent } from "@/lib/communities/models/events";

/**
 * Server-side access to the city Events page — the workspace page listing the
 * public events of the viewer's own city.
 *
 * The listing itself is a database function (see
 * supabase/migrations/20261010120000_event_city.sql) with the same phase
 * semantics and keyset cursor as the community events list; this module only
 * shapes the call and enriches the rows into cards, exactly like every other
 * event surface does through `enrichEventCards`.
 */

export const CITY_EVENT_PAGE_SIZE = 25;

/** The city RPC's projection adds the community attribution the card shows. */
export type CityEventItem = CommunityEvent & {
  community_name?: string | null;
  community_image?: string | null;
};

export interface CityEventViewer {
  id: string;
  cityId: string;
  cityName: string;
}

/**
 * The viewer's own city, or null when their profile has none — the page then
 * asks them to set one instead of guessing.
 */
export async function loadCityEventViewer(
  db: SupabaseClient,
  userId: string,
): Promise<CityEventViewer | null> {
  const { data, error } = await db
    .from("designer_profiles")
    .select("city_id, cities(id, name)")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) console.error("[city events] viewer read failed:", error);

  const profile = data as { city_id?: string | null; cities?: { id: string; name: string } | null } | null;
  const cityName = profile?.cities?.name ?? null;
  if (!profile?.city_id || !cityName) return null;

  return { id: userId, cityId: profile.city_id, cityName };
}

/**
 * One page of the viewer's city public events, in the given phase, resolved
 * into cards with every interaction flag for the viewer.
 *
 * The cursor is the same `phase|event_date|id` compound the community events
 * API uses: `nextCursor` is "past" once an exhausted *upcoming* page hands
 * over (the page formats it into the URL; the API parses it back), and null
 * when the phase has no further rows.
 */
export async function fetchCityEventPhase(
  db: SupabaseClient,
  opts: {
    cityId: string;
    viewerId: string;
    phase: "upcoming" | "past";
    cursorDate?: string | null;
    cursorId?: string | null;
    now?: Date;
  },
): Promise<{ events: CityEventItem[]; nextCursor: string | null }> {
  const { cityId, viewerId, phase, cursorDate = null, cursorId = null, now = new Date() } = opts;

  const { data, error } = await callPerformanceRpc(db, "get_city_event_list_page", {
    p_city_id: cityId,
    p_user_id: viewerId,
    p_phase: phase,
    p_cursor_event_date: cursorDate,
    p_cursor_id: cursorId,
    p_now: now.toISOString(),
    // One extra row tells us whether another page exists without a count.
    p_limit: CITY_EVENT_PAGE_SIZE + 1,
  });
  if (error) throw new Error("Failed to fetch city events.");

  const rows = (data ?? []).map(({ item }) => item as Record<string, unknown>);
  const page = rows.slice(0, CITY_EVENT_PAGE_SIZE);
  const events = await enrichEventCards(page, viewerId);

  const last = page.at(-1);
  const nextCursor =
    rows.length > CITY_EVENT_PAGE_SIZE && last
      ? `${phase}|${toUtcCursor(last.event_date as string)}|${last.id as string}`
      : phase === "upcoming"
        ? "past"
        : null;

  return { events, nextCursor };
}
