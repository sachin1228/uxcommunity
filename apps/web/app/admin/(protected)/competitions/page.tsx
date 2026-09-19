import { listCompetitions, getAdminEntries, getStatsBulk } from "@/lib/competitions/queries";
import { createServiceClient } from "@/lib/supabase/service";
import {
  AdminCompetitionsManager,
  type AdminCompetition,
} from "@/components/competitions/AdminCompetitionsManager";

export const metadata = { title: "Competitions — Admin" };

/**
 * Competition management.
 *
 * Loaded on the server so the page arrives with every cycle, its stats and its
 * entries already in hand; the client manager mutates and then refreshes, which
 * keeps one source of truth for what the list shows.
 */
export default async function AdminCompetitionsPage() {
  const db = createServiceClient();
  const competitions = await listCompetitions(db, 200);
  const ids = competitions.map((competition) => competition.id);

  const [stats, entriesByCompetition] = await Promise.all([
    getStatsBulk(db, ids),
    Promise.all(ids.map((id) => getAdminEntries(db, id))),
  ]);

  const rows: AdminCompetition[] = competitions.map((competition, index) => ({
    ...competition,
    stats: stats.get(competition.id) ?? {
      entries: 0,
      designers: 0,
      votes: 0,
      comments: 0,
      participants: 0,
    },
    entries: entriesByCompetition[index] ?? [],
  }));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-lg font-semibold text-foreground">Competitions</h1>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Create the weekly challenge, edit its brief and rules, moderate entries, and notify
          members. A cycle becomes live, gives way to results and lands in the archive purely on its
          own schedule.
        </p>
      </header>

      <AdminCompetitionsManager competitions={rows} />
    </div>
  );
}
