import Link from "next/link";
import { ArrowRight, CalendarClock, Trophy } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Countdown } from "./Countdown";
import { MetaLine, SectionHeading, StatsRow, StatusChip, WeekBadge } from "./CompetitionChrome";
import { countdownLabel, countdownTarget, formatCycleDate } from "@/lib/competitions/cycle";
import type {
  ArchivedCompetition,
  Competition,
  CompetitionEntry,
  CompetitionStats,
  CompetitionWinner,
} from "@/lib/competitions/types";

const SHELL = "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8";

export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className={SHELL}>{children}</div>;
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground shadow-sm transition-[filter] hover:brightness-110"
    >
      {children}
    </Link>
  );
}

function GhostLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface-raised px-4 py-2.5 font-body text-sm font-semibold text-foreground-muted shadow-xs transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}

/** The week's hero: the challenge, its countdown, its numbers, and the way in. */
export function CompetitionHero({
  competition,
  stats,
  winner,
}: {
  competition: Competition;
  stats: CompetitionStats | null;
  winner: CompetitionWinner | null;
}) {
  const target = countdownTarget(competition.status, competition);
  const isResults = competition.status === "results" || competition.status === "archived";

  return (
    <section className="overflow-hidden rounded-2xl bg-surface-raised shadow-sm">
      <div className="relative">
        {competition.cover_image_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={competition.cover_image_url}
              alt=""
              className="h-40 w-full object-cover sm:h-56"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
          </>
        ) : (
          <div className="h-2 w-full bg-gradient-to-r from-accent/70 via-accent/30 to-transparent" />
        )}

        <div
          className={`${competition.cover_image_url ? "absolute bottom-0 left-0 right-0" : ""} flex flex-wrap items-center gap-3 p-5 sm:p-8`}
        >
          <WeekBadge
            week={competition.week_number}
            className={competition.cover_image_url ? "text-white/80" : ""}
          />
          <StatusChip status={competition.status} />
        </div>
      </div>

      <div className="p-5 sm:p-8">
        <MetaLine items={[competition.category, `${competition.difficulty} level`]} />

        <h1 className="mt-2 text-balance font-display text-2xl font-semibold leading-tight text-foreground sm:text-4xl">
          {competition.title}
        </h1>

        {competition.description && (
          <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-foreground-muted sm:text-base">
            {competition.description}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-5">
          {target && (
            <div>
              <p className="mb-1 font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                {countdownLabel(competition.status)}
              </p>
              <Countdown target={target} label={competition.status === "live" ? "left" : undefined} size="lg" />
              <p className="mt-1 font-body text-xs text-foreground-subtle">
                {competition.status === "live"
                  ? `Submissions close ${formatCycleDate(competition.submission_deadline)}`
                  : `Opens ${formatCycleDate(competition.start_at)}`}
              </p>
            </div>
          )}

          {stats && (
            <StatsRow
              items={[
                { value: stats.entries, label: "Submissions" },
                { value: stats.votes, label: "Votes" },
                { value: stats.participants, label: "Participants" },
              ]}
            />
          )}
        </div>

        {isResults && winner && (
          <div className="mt-6 flex items-center gap-4 rounded-xl bg-background-subtle p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={winner.cover_image_url}
              alt={winner.title}
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                <Trophy size={13} strokeWidth={2.5} /> Winner
              </p>
              <p className="mt-0.5 truncate font-display text-sm font-semibold text-foreground">
                {winner.title}
              </p>
              <p className="truncate font-body text-xs text-foreground-muted">
                {winner.author_name} · {winner.vote_count.toLocaleString("en-IN")} votes
              </p>
            </div>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          {competition.status === "live" && (
            <PrimaryLink href={`/dashboard/competitions/${competition.slug}/submit`}>
              Submit your design
            </PrimaryLink>
          )}
          <GhostLink href={`/dashboard/competitions/${competition.slug}`}>
            {isResults ? "See the results" : "View challenge"}
            <ArrowRight size={15} strokeWidth={2.5} />
          </GhostLink>
        </div>
      </div>
    </section>
  );
}

/** Sunday → Saturday, the ritual the whole feature is built around. */
export function WeekRitual() {
  const steps = [
    { day: "Sunday", text: "New challenge drops." },
    { day: "Monday–Friday", text: "Designers create and submit." },
    { day: "Friday", text: "Final submissions, then voting." },
    { day: "Saturday", text: "Results and the winner." },
  ];

  return (
    <section className="rounded-2xl bg-background-subtle p-5 sm:p-7">
      <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
        Every week
      </p>
      <h2 className="mt-1 font-display text-lg font-semibold text-foreground">
        One challenge. Seven days. Everyone&apos;s work on the wall.
      </h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.day} className="flex gap-3">
            <span className="mt-0.5 font-mono text-xs font-semibold text-foreground-subtle">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>
              <span className="block font-body text-xs font-semibold text-foreground">{step.day}</span>
              <span className="mt-0.5 block font-body text-xs leading-relaxed text-foreground-muted">
                {step.text}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Next Sunday's brief — visible, but closed for submissions. */
export function UpcomingCompetition({ competition }: { competition: Competition }) {
  return (
    <section className="rounded-2xl bg-surface-raised p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            <CalendarClock size={13} strokeWidth={2.5} /> Next competition
          </p>
          <h2 className="mt-1.5 font-display text-lg font-semibold text-foreground sm:text-xl">
            {competition.title}
          </h2>
          <MetaLine
            items={[
              `Week ${String(competition.week_number).padStart(2, "0")}`,
              competition.category,
              `Starts ${formatCycleDate(competition.start_at)}`,
            ]}
          />
        </div>
        <div className="text-right">
          <Countdown target={competition.start_at} label="to go" size="md" />
        </div>
      </div>

      {competition.description && (
        <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-foreground-muted">
          {competition.description}
        </p>
      )}

      <p className="mt-4 font-body text-xs text-foreground-subtle">
        Submissions open the moment the challenge starts — no early entries.
      </p>
      <div className="mt-5">
        <GhostLink href={`/dashboard/competitions/${competition.slug}`}>Read the brief</GhostLink>
      </div>
    </section>
  );
}

/** Recent finished weeks, with the winner each one produced. */
export function ArchivePreview({
  items,
  showHeading = true,
}: {
  items: ArchivedCompetition[];
  showHeading?: boolean;
}) {
  if (!items.length) return null;

  return (
    <section>
      {showHeading && (
        <SectionHeading
          eyebrow="History"
          title="Past competitions"
          className="mb-4"
          action={
            <Link
              href="/dashboard/competitions/archive"
              className="font-body text-xs font-semibold text-accent hover:underline"
            >
              View all
            </Link>
          }
        />
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface-raised shadow-sm">
        {items.map(({ competition, stats, winner }) => (
          <li key={competition.id}>
            <Link
              href={`/dashboard/competitions/${competition.slug}`}
              className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-background-subtle sm:px-5"
            >
              {winner ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={winner.cover_image_url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-background-subtle font-mono text-xs font-semibold text-foreground-subtle">
                  {String(competition.week_number).padStart(2, "0")}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <WeekBadge week={competition.week_number} />
                <p className="mt-0.5 truncate font-display text-sm font-semibold text-foreground">
                  {competition.title}
                </p>
                <p className="mt-0.5 truncate font-body text-xs text-foreground-muted">
                  {winner
                    ? `Won by ${winner.author_name} · ${winner.vote_count.toLocaleString("en-IN")} votes`
                    : "No entries"}
                  {` · ${stats.designers} ${stats.designers === 1 ? "designer" : "designers"}`}
                </p>
              </div>

              <ArrowRight size={16} strokeWidth={2.5} className="shrink-0 text-foreground-subtle" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A quiet gallery preview for the landing page. */
export function GalleryPreview({
  slug,
  entries,
  headingHref,
}: {
  slug: string;
  entries: CompetitionEntry[];
  headingHref: string;
}) {
  if (!entries.length) return null;

  return (
    <section>
      <SectionHeading
        eyebrow="This week"
        title="Fresh on the wall"
        className="mb-4"
        action={
          <Link href={headingHref} className="font-body text-xs font-semibold text-accent hover:underline">
            See all entries
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            href={`/dashboard/competitions/${slug}/entries/${entry.id}`}
            className="group block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.cover_image_url}
              alt={entry.title}
              loading="lazy"
              className="aspect-[4/5] w-full rounded-xl object-cover shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5"
            />
            <p className="mt-2 truncate font-body text-[11px] font-semibold text-foreground">
              {entry.author_name}
            </p>
            <p className="truncate font-body text-[11px] text-foreground-subtle">{entry.title}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Winner portrait used by the results view and archive. */
export function WinnerSpotlight({
  winner,
  href,
  voteLabel = "votes",
}: {
  winner: CompetitionWinner;
  href: string;
  voteLabel?: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-surface-raised shadow-sm">
      <Link href={href} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={winner.design_image_url || winner.cover_image_url}
          alt={winner.title}
          className="max-h-[560px] w-full bg-background-subtle object-contain"
        />
      </Link>
      <div className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
        <AvatarImg
          url={winner.author_avatar_url}
          name={winner.author_name}
          size={48}
          className="h-12 w-12 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Trophy size={13} strokeWidth={2.5} /> Winner
          </p>
          <p className="mt-0.5 truncate font-display text-base font-semibold text-foreground">
            {winner.author_name}
          </p>
          <p className="truncate font-body text-xs text-foreground-muted">{winner.title}</p>
        </div>
        <p className="font-display text-xl font-semibold tabular-nums text-foreground">
          {winner.vote_count.toLocaleString("en-IN")}
          <span className="ml-1 font-body text-xs font-normal text-foreground-subtle">{voteLabel}</span>
        </p>
      </div>
    </section>
  );
}
