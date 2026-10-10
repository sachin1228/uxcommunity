import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchCityEventPhase, loadCityEventViewer, type CityEventItem } from "@/lib/events/service";
import { CityEventsView } from "@/components/events/CityEventsView";

export const metadata = { title: "Events — uxcommunity" };

/**
 * The workspace Events page: the public events of the viewer's own city,
 * upcoming and past in one round trip. "Load more" pages each phase through
 * /api/events/city; beyond that the page is server-rendered like every other
 * workspace surface.
 */
export default async function EventsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const userId = session.userId!;
  const viewer = await loadCityEventViewer(db, userId);

  let upcoming: CityEventItem[] = [];
  let past: CityEventItem[] = [];
  let upcomingCursor: string | null = null;
  let pastCursor: string | null = null;
  let loadFailed = false;

  if (viewer) {
    try {
      const [upcomingPage, pastPage] = await Promise.all([
        fetchCityEventPhase(db, { cityId: viewer.cityId, viewerId: userId, phase: "upcoming" }),
        fetchCityEventPhase(db, { cityId: viewer.cityId, viewerId: userId, phase: "past" }),
      ]);
      upcoming = upcomingPage.events;
      upcomingCursor = upcomingPage.nextCursor;
      past = pastPage.events;
      pastCursor = pastPage.nextCursor;
    } catch (error) {
      // The city feed is missing or unreachable (e.g. its migration has not
      // been applied yet) — say so rather than pretending the city is empty.
      console.error("[events page] city feed failed:", error);
      loadFailed = true;
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <CityEventsView
        currentUserId={userId}
        cityName={viewer?.cityName ?? null}
        initialUpcoming={upcoming}
        initialPast={past}
        initialUpcomingCursor={upcomingCursor}
        initialPastCursor={pastCursor}
        loadFailed={loadFailed}
      />
    </div>
  );
}
