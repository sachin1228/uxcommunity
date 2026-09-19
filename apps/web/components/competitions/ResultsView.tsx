import Link from "next/link";
import { ArrowRight, Sparkles, Trophy } from "lucide-react";
import { EntryCard } from "./EntryCard";
import { SectionHeading, StatsRow } from "./CompetitionChrome";
import { WinnerSpotlight } from "./CompetitionSections";
import type { Competition, CompetitionEntry, CompetitionStats } from "@/lib/competitions/types";

/**
 * Saturday.
 *
 * Not a leaderboard — an award ceremony. The winner gets a full-width
 * presentation of the actual design, then editors' picks, then the entries the
 * community voted for most. Numbers are present but quiet; the work is the
 * announcement.
 */
export function ResultsView({
  competition,
  entries,
  stats,
  currentUserId,
}: {
  competition: Competition;
  entries: CompetitionEntry[];
  stats: CompetitionStats;
  currentUserId: string;
}) {
  const slug = competition.slug;
  const byVotes = [...entries].sort((a, b) => b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at));
  const winner = byVotes[0] ?? null;
  const featured = entries.filter((entry) => entry.is_featured);
  const favourites = byVotes.filter((entry) => entry.id !== winner?.id).slice(0, 6);
  const featuredIds = new Set(featured.map((entry) => entry.id));

  return (
    <div className="flex flex-col gap-10">
      <header className="text-center">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
          Week {String(competition.week_number).padStart(2, "0")} · {competition.category}
        </p>
        <h1 className="mt-2 text-balance font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          Results are in 🎉
        </h1>
        <p className="mt-2 font-body text-sm text-foreground-muted">
          {competition.title}
        </p>
      </header>

      {winner ? (
        <section>
          <SectionHeading
            eyebrow="🏆 Winner"
            title={winner.title}
            className="mb-4"
            action={
              <Link
                href={`/dashboard/competitions/${slug}/entries/${winner.id}`}
                className="font-body text-xs font-semibold text-accent hover:underline"
              >
                Open entry
              </Link>
            }
          />
          <WinnerSpotlight winner={{ ...toWinner(winner), competition_id: competition.id }} href={`/dashboard/competitions/${slug}/entries/${winner.id}`} />
        </section>
      ) : (
        <p className="rounded-2xl bg-surface-raised p-6 text-center font-body text-sm text-foreground-muted shadow-sm">
          No entries were submitted for this challenge.
        </p>
      )}

      {featured.length > 0 && (
        <section>
          <SectionHeading eyebrow="✨ Featured entries" title="Editors' picks" className="mb-4" />
          <div className="columns-1 gap-5 sm:columns-2 xl:columns-3">
            {featured.map((entry) => (
              <EntryCard
                key={entry.id}
                slug={slug}
                entry={entry}
                currentUserId={currentUserId}
                votingOpen={false}
                emphasis="featured"
              />
            ))}
          </div>
        </section>
      )}

      {favourites.length > 0 && (
        <section>
          <SectionHeading
            eyebrow="👏 Community favourites"
            title="The entries you voted for"
            className="mb-4"
            action={
              <Link
                href={`/dashboard/competitions/${slug}#entries`}
                className="inline-flex items-center gap-1 font-body text-xs font-semibold text-accent hover:underline"
              >
                View all entries <ArrowRight size={13} strokeWidth={2.5} />
              </Link>
            }
          />
          <div className="columns-1 gap-5 sm:columns-2 xl:columns-3">
            {favourites
              .filter((entry) => !featuredIds.has(entry.id))
              .map((entry) => (
                <EntryCard
                  key={entry.id}
                  slug={slug}
                  entry={entry}
                  currentUserId={currentUserId}
                  votingOpen={false}
                />
              ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl bg-background-subtle p-5 sm:p-7">
        <SectionHeading eyebrow="📊 Competition stats" title="How the week went" className="mb-5" />
        <StatsRow
          size="lg"
          items={[
            { value: stats.votes, label: "Votes" },
            { value: stats.designers, label: "Designers" },
            { value: stats.entries, label: "Entries" },
            { value: stats.comments, label: "Comments" },
          ]}
        />
        <p className="mt-5 flex items-center gap-1.5 font-body text-xs text-foreground-subtle">
          <Sparkles size={13} strokeWidth={2.5} />
          Next challenge drops Sunday — a new brief, a clean wall.
        </p>
      </section>
    </div>
  );
}

/** Shapes a gallery entry into the winner card the spotlight expects. */
function toWinner(entry: CompetitionEntry) {
  return {
    entry_id: entry.id,
    user_id: entry.user_id,
    title: entry.title,
    cover_image_url: entry.cover_image_url,
    design_image_url: entry.design_image_url,
    author_name: entry.author_name,
    author_avatar_url: entry.author_avatar_url,
    vote_count: entry.vote_count,
  };
}

export function WinnerBanner({ competition, entries }: { competition: Competition; entries: CompetitionEntry[] }) {
  const winner = [...entries].sort((a, b) => b.vote_count - a.vote_count)[0];
  if (!winner) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-3">
      <Trophy size={15} strokeWidth={2.5} className="text-accent" />
      <p className="font-body text-xs font-semibold text-foreground">
        {winner.author_name} won Week {competition.week_number} with {winner.vote_count.toLocaleString("en-IN")} votes
      </p>
    </div>
  );
}
