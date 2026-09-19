import { redirect } from "next/navigation";
import { Palette } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCompetitionHome } from "@/lib/competitions/queries";
import { deferDueCompetitionBroadcasts } from "@/lib/competitions/notifications";
import { withCompetitionSchema } from "@/lib/competitions/setup";
import { CompetitionSetupNotice, EmptyState } from "@/components/competitions/CompetitionChrome";
import {
  ArchivePreview,
  CompetitionHero,
  GalleryPreview,
  PageShell,
  UpcomingCompetition,
  WeekRitual,
} from "@/components/competitions/CompetitionSections";

export const metadata = { title: "Competitions — uxcommunity" };

/**
 * The weekly competition dashboard.
 *
 * Order of attention, top to bottom: this week's challenge and its countdown,
 * the work already on the wall, the rhythm of the week, then what is coming and
 * what has been. A finished week leads with its winner instead of an empty
 * challenge, and between cycles the next brief takes the hero slot.
 */
export default async function CompetitionsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");
  const userId = session.userId!;

  const db = createServiceClient();

  // An environment where the migration has not run yet must explain itself
  // rather than render a raw PostgREST error.
  const loaded = await withCompetitionSchema(() => loadCompetitionHome(db, userId));
  if (!loaded.ok) return <CompetitionSetupNotice />;

  const { current, currentStats, currentEntries, currentWinner, upcoming, archive } = loaded.data;

  // Keep the weekly rhythm without a cron: whichever cycle is due claims its
  // notification here, once (see lib/competitions/notifications.ts).
  deferDueCompetitionBroadcasts([current, upcoming].filter(Boolean) as NonNullable<typeof current>[]);

  const heroCompetition = current ?? upcoming ?? null;
  const heroIsUpcomingOnly = !current && Boolean(upcoming);

  return (
    <PageShell>
      <header className="mb-6">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
          Weekly Competition
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-foreground sm:text-3xl">
          Design something every week
        </h1>
      </header>

      <div className="flex flex-col gap-10">
        {heroCompetition ? (
          heroIsUpcomingOnly ? (
            <UpcomingCompetition competition={heroCompetition} />
          ) : (
            <CompetitionHero
              competition={heroCompetition}
              stats={currentStats}
              winner={currentWinner}
            />
          )
        ) : (
          <EmptyState
            icon={<Palette size={28} strokeWidth={2} />}
            title="No competition yet"
            hint="The first weekly challenge is being written. Check back on Sunday."
          />
        )}

        {current && currentEntries.length > 0 && (
          <GalleryPreview
            slug={current.slug}
            entries={currentEntries}
            headingHref={`/dashboard/competitions/${current.slug}#entries`}
          />
        )}

        <WeekRitual />

        {upcoming && current && <UpcomingCompetition competition={upcoming} />}

        <ArchivePreview items={archive} />
      </div>
    </PageShell>
  );
}
