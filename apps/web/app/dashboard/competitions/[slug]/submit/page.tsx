import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCompetitionDetail } from "@/lib/competitions/queries";
import { canSubmitEntry, formatCycleDate } from "@/lib/competitions/cycle";
import { MetaLine, StatusChip, WeekBadge } from "@/components/competitions/CompetitionChrome";
import { PageShell } from "@/components/competitions/CompetitionSections";
import { SubmitEntryForm } from "@/components/competitions/SubmitEntryForm";

export const metadata = { title: "Submit your design — uxcommunity" };

/**
 * Submit your design.
 *
 * Loads the designer's existing entry first, so this page is the editor as well
 * as the create form. When submissions are closed the page still explains why
 * rather than 404-ing — a shared link to "submit" should land somewhere real.
 */
export default async function SubmitEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");
  const userId = session.userId!;

  const { slug } = await params;
  const db = createServiceClient();
  const payload = await loadCompetitionDetail(db, slug, userId);
  if (!payload) notFound();

  const { competition, myEntry } = payload;
  const open = canSubmitEntry(competition.status);

  return (
    <PageShell>
      <Link
        href={`/dashboard/competitions/${competition.slug}`}
        className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} strokeWidth={2.5} />
        {competition.title}
      </Link>

      <header className="mb-6 mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <WeekBadge week={competition.week_number} />
          <StatusChip status={competition.status} />
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold text-foreground">
          {myEntry ? "Edit your submission" : "Submit your design"}
        </h1>
        <MetaLine
          className="mt-1.5"
          items={[
            `Week ${String(competition.week_number).padStart(2, "0")}`,
            competition.category,
            `Deadline ${formatCycleDate(competition.submission_deadline)}`,
          ]}
        />
      </header>

      {open ? (
        <SubmitEntryForm
          slug={competition.slug}
          competitionTitle={competition.title}
          deadlineLabel={formatCycleDate(competition.submission_deadline)}
          existingEntry={myEntry}
        />
      ) : (
        <section className="rounded-2xl bg-surface-raised p-6 shadow-sm">
          <p className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            <Lock size={16} strokeWidth={2.5} className="text-foreground-subtle" />
            Submissions are closed
          </p>
          <p className="mt-2 max-w-xl font-body text-sm text-foreground-muted">
            {competition.status === "upcoming"
              ? `This challenge opens ${formatCycleDate(competition.start_at)}. You can read the brief now and come back then.`
              : `The deadline for ${competition.title} was ${formatCycleDate(competition.submission_deadline)}.`}
          </p>
          <Link
            href={`/dashboard/competitions/${competition.slug}`}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground shadow-sm"
          >
            View the challenge
          </Link>
        </section>
      )}
    </PageShell>
  );
}
