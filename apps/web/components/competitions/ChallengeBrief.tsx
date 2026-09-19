import { Check } from "lucide-react";
import { MetaLine, StatsRow } from "./CompetitionChrome";
import { formatCycleDate } from "@/lib/competitions/cycle";
import type { Competition, CompetitionStats } from "@/lib/competitions/types";

/**
 * The brief.
 *
 * Written to be read, not skimmed past: the problem, what to make, what to hand
 * in and how it will be judged, each as its own block. The rules sit beside the
 * deadline so the two things a designer must not miss are in one column.
 */
export function ChallengeBrief({
  competition,
  stats,
}: {
  competition: Competition;
  stats: CompetitionStats;
}) {
  const brief = competition.brief;
  const blocks = [
    { key: "problem", label: "The problem", body: brief.problem },
    { key: "challenge", label: "What to design", body: brief.challenge },
    { key: "deliverable", label: "Deliverable", body: brief.deliverable },
    { key: "dimensions", label: "Recommended dimensions", body: brief.dimensions },
    { key: "judging", label: "How it's judged", body: brief.judging },
  ].filter((block) => Boolean(block.body?.trim()));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section id="brief" className="rounded-2xl bg-surface-raised p-5 shadow-sm sm:p-7">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
          Challenge brief
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold text-foreground sm:text-2xl">
          {competition.title}
        </h2>

        {competition.description && (
          <p className="mt-3 font-body text-base leading-relaxed text-foreground">
            {competition.description}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-6">
          {blocks.length === 0 && (
            <p className="font-body text-sm text-foreground-muted">
              The full brief for this week is coming shortly.
            </p>
          )}
          {blocks.map((block) => (
            <div key={block.key}>
              <h3 className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                {block.label}
              </h3>
              <p className="mt-1.5 whitespace-pre-line font-body text-sm leading-relaxed text-foreground-muted">
                {block.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <aside className="flex flex-col gap-5">
        <section id="rules" className="rounded-2xl bg-surface-raised p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold text-foreground">Rules</h2>
          <ol className="mt-3 flex flex-col gap-2.5">
            {competition.rules.map((rule, index) => (
              <li key={`${rule}-${index}`} className="flex gap-2.5">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Check size={11} strokeWidth={3} />
                </span>
                <span className="font-body text-xs leading-relaxed text-foreground-muted">{rule}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl bg-background-subtle p-5">
          <h2 className="font-display text-base font-semibold text-foreground">Key dates</h2>
          <dl className="mt-3 flex flex-col gap-3">
            <DateRow label="Challenge opens" value={competition.start_at} />
            <DateRow label="Submissions close" value={competition.submission_deadline} />
            <DateRow label="Voting closes" value={competition.voting_deadline} />
            <DateRow label="Results published" value={competition.results_at} />
          </dl>

          <div className="mt-5 border-t border-border pt-4">
            <MetaLine
              items={[
                `Week ${String(competition.week_number).padStart(2, "0")}`,
                competition.category,
                `${competition.difficulty} level`,
              ]}
            />
            <StatsRow
              className="mt-3"
              size="sm"
              items={[
                { value: stats.entries, label: "Entries" },
                { value: stats.votes, label: "Votes" },
              ]}
            />
          </div>
        </section>

        <p className="px-1 font-body text-[11px] leading-relaxed text-foreground-subtle">
          One submission per person. Designs must be original and made by you — the community votes
          on the work, so keep the playing field honest.
        </p>
      </aside>
    </div>
  );
}

function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-body text-xs text-foreground-muted">{label}</dt>
      <dd className="text-right font-body text-xs font-semibold text-foreground">
        {formatCycleDate(value)}
      </dd>
    </div>
  );
}
