import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Palette, PenLine } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCompetitionDetail, resolveEntrySort } from "@/lib/competitions/queries";
import { deferDueCompetitionBroadcasts } from "@/lib/competitions/notifications";
import { canRankByVotes, canVote, countdownLabel, countdownTarget, formatCycleDate } from "@/lib/competitions/cycle";
import { MetaLine, SectionHeading, StatsRow, StatusChip, WeekBadge } from "@/components/competitions/CompetitionChrome";
import { ChallengeBrief } from "@/components/competitions/ChallengeBrief";
import { Countdown } from "@/components/competitions/Countdown";
import { EntryGrid } from "@/components/competitions/EntryGrid";
import { ResultsView } from "@/components/competitions/ResultsView";
import { PageShell } from "@/components/competitions/CompetitionSections";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}

/**
 * One weekly challenge.
 *
 * While the week is running this is the brief plus the gallery. On results day
 * the same URL becomes the results experience — the competition is not copied
 * into a second page, it changes state, so every shared link keeps working and
 * the archive is just the same page as time passes.
 */
export default async function CompetitionPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");
  const userId = session.userId!;

  const { slug } = await params;
  const { sort } = await searchParams;

  const db = createServiceClient();
  const payload = await loadCompetitionDetail(db, slug, userId, { sort: sort ?? null });
  if (!payload) notFound();

  const { competition, stats, entries, myEntry, winner, upcoming } = payload;

  deferDueCompetitionBroadcasts([competition]);

  const isUpcoming = competition.status === "upcoming";
  const showResults = competition.status === "results" || competition.status === "archived";
  const votingOpen = canVote(competition.status);
  const submittingOpen = competition.status === "live";
  const target = countdownTarget(competition.status, competition);
  const activeSort = resolveEntrySort(sort ?? null, competition.status) as
    | "recent"
    | "oldest"
    | "votes"
    | "featured";

  if (showResults) {
    return (
      <PageShell>
        <BackLink />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <WeekBadge week={competition.week_number} />
          <StatusChip status={competition.status} />
          <MetaLine items={[competition.category, `Voting closed ${formatCycleDate(competition.voting_deadline)}`]} />
        </div>

        <div className="mt-6">
          <ResultsView
            competition={competition}
            entries={entries}
            stats={stats}
            currentUserId={userId}
          />
        </div>

        {upcoming && <NextCompetition upcoming={upcoming} className="mt-10" />}
      </PageShell>
    );
  }

  return (
    <PageShell>
      <BackLink />

      {/* ── Challenge header ────────────────────────────────────────── */}
      <header className="mt-4 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <WeekBadge week={competition.week_number} />
          <StatusChip status={competition.status} />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-balance font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
              {competition.title}
            </h1>
            <MetaLine
              className="mt-2"
              items={[
                competition.category,
                `${competition.difficulty} level`,
                `Submissions ${isUpcoming ? "open" : "close"} ${formatCycleDate(isUpcoming ? competition.start_at : competition.submission_deadline)}`,
              ]}
            />
          </div>

          {target && (
            <div className="rounded-xl bg-surface-raised px-4 py-3 shadow-sm">
              <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                {countdownLabel(competition.status)}
              </p>
              <Countdown target={target} size="md" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <StatsRow
            size="sm"
            items={[
              { value: stats.participants, label: "Participants" },
              { value: stats.entries, label: "Entries" },
              { value: stats.votes, label: "Votes" },
            ]}
          />

          <div className="flex flex-wrap items-center gap-3">
            {submittingOpen && (
              <Link
                href={`/dashboard/competitions/${competition.slug}/submit`}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground shadow-sm transition-[filter] hover:brightness-110"
              >
                <PenLine size={15} strokeWidth={2.5} />
                {myEntry ? "Edit your entry" : "Submit your design"}
              </Link>
            )}
            <Link
              href="#entries"
              className="inline-flex items-center gap-2 rounded-lg bg-surface-raised px-4 py-2.5 font-body text-sm font-semibold text-foreground-muted shadow-xs transition-colors hover:text-foreground"
            >
              View entries <ArrowRight size={15} strokeWidth={2.5} />
            </Link>
          </div>
        </div>

        {myEntry && (
          <p className="flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-3 font-body text-xs font-semibold text-foreground">
            ✓ Entry submitted — {myEntry.title}
            <Link
              href={`/dashboard/competitions/${competition.slug}/entries/${myEntry.id}`}
              className="text-accent hover:underline"
            >
              view it
            </Link>
          </p>
        )}
      </header>

      {/* ── Brief + rules ───────────────────────────────────────────── */}
      <div className="mt-9">
        <ChallengeBrief competition={competition} stats={stats} />
      </div>

      {/* ── Gallery ─────────────────────────────────────────────────── */}
      <section id="entries" className="mt-12 scroll-mt-6">
        <SectionHeading
          eyebrow={isUpcoming ? "The wall opens Sunday" : "This week's entries"}
          title={isUpcoming ? "No entries yet" : "Design showcase"}
          className="mb-5"
        />

        {isUpcoming ? (
          <p className="rounded-2xl bg-surface-raised p-6 font-body text-sm text-foreground-muted shadow-sm">
            Entries appear here the moment the challenge starts. Read the brief now and have your
            files ready.
          </p>
        ) : (
          <EntryGrid
            slug={competition.slug}
            entries={entries}
            currentUserId={userId}
            votingOpen={votingOpen}
            rankingOpen={canRankByVotes(competition.status)}
            sort={activeSort}
            myEntryId={myEntry?.id ?? null}
            emptyAction={
              submittingOpen ? (
                <Link
                  href={`/dashboard/competitions/${competition.slug}/submit`}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground shadow-sm"
                >
                  <Palette size={15} strokeWidth={2.5} /> Submit the first design
                </Link>
              ) : null
            }
          />
        )}
      </section>

      {upcoming && <NextCompetition upcoming={upcoming} className="mt-12" />}

      {/* Mobile: the submit action follows the designer down the page. */}
      {submittingOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-surface/95 p-3 shadow-md backdrop-blur min-[500px]:hidden">
          <Link
            href={`/dashboard/competitions/${competition.slug}/submit`}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-body text-sm font-semibold text-accent-foreground shadow-sm"
          >
            <PenLine size={15} strokeWidth={2.5} />
            {myEntry ? "Edit your entry" : "Submit your design"}
          </Link>
        </div>
      )}
    </PageShell>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/competitions"
      className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft size={14} strokeWidth={2.5} />
      Competitions
    </Link>
  );
}

function NextCompetition({
  upcoming,
  className = "",
}: {
  upcoming: { slug: string; title: string; week_number: number; start_at: string };
  className?: string;
}) {
  return (
    <section className={`rounded-2xl bg-surface-raised p-5 shadow-sm sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            Next Sunday
          </p>
          <p className="mt-1 font-display text-base font-semibold text-foreground">{upcoming.title}</p>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            Week {String(upcoming.week_number).padStart(2, "0")} · starts{" "}
            {formatCycleDate(upcoming.start_at)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Countdown target={upcoming.start_at} size="sm" />
          <Link
            href={`/dashboard/competitions/${upcoming.slug}`}
            className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-accent hover:underline"
          >
            Preview <ArrowRight size={13} strokeWidth={2.5} />
          </Link>
        </div>
      </div>
    </section>
  );
}
