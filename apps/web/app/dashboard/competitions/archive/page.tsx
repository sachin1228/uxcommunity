import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Archive } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCompetitionArchive } from "@/lib/competitions/queries";
import { withCompetitionSchema } from "@/lib/competitions/setup";
import { CompetitionSetupNotice, EmptyState } from "@/components/competitions/CompetitionChrome";
import { ArchivePreview, PageShell } from "@/components/competitions/CompetitionSections";

export const metadata = { title: "Past competitions — uxcommunity" };

/**
 * The archive.
 *
 * Every finished cycle keeps its brief, entries, votes, winner and participant
 * count, and stays reachable forever — the work people made is the point of the
 * whole feature, so it must not disappear the moment a new week starts.
 */
export default async function CompetitionArchivePage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const loaded = await withCompetitionSchema(() => loadCompetitionArchive(db));
  if (!loaded.ok) return <CompetitionSetupNotice />;
  const archive = loaded.data;

  return (
    <PageShell>
      <Link
        href="/dashboard/competitions"
        className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} strokeWidth={2.5} />
        Competitions
      </Link>

      <header className="mb-6 mt-4">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
          Archive
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-foreground sm:text-3xl">
          Past competitions
        </h1>
        <p className="mt-2 max-w-2xl font-body text-sm text-foreground-muted">
          Every week we have run, with its brief, its entries and the design the community chose.
        </p>
      </header>

      {archive.length ? (
        <ArchivePreview items={archive} showHeading={false} />
      ) : (
        <EmptyState
          icon={<Archive size={28} strokeWidth={2} />}
          title="Nothing archived yet"
          hint="Finished challenges land here once the week is over."
        />
      )}
    </PageShell>
  );
}
