import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getComments, getCompetitionBySlug, getEntry } from "@/lib/competitions/queries";
import { canComment, canVote } from "@/lib/competitions/cycle";
import { EntryDetailView } from "@/components/competitions/EntryDetailView";

export const metadata = { title: "Entry — uxcommunity" };

/**
 * A single entry, in full.
 *
 * Fetched on the server so the design and the discussion are in the first
 * paint; voting and commenting then talk to the API, which is where every rule
 * about deadlines and ownership is enforced.
 */
export default async function CompetitionEntryPage({
  params,
}: {
  params: Promise<{ slug: string; entryId: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");
  const userId = session.userId!;

  const { slug, entryId } = await params;
  const db = createServiceClient();

  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) notFound();

  const entry = await getEntry(db, competition.id, entryId, userId);
  if (!entry) notFound();

  const comments = await getComments(db, entryId);

  return (
    <EntryDetailView
      slug={competition.slug}
      entry={entry}
      comments={comments}
      currentUserId={userId}
      competitionTitle={competition.title}
      weekNumber={competition.week_number}
      votingOpen={canVote(competition.status)}
      commentingOpen={canComment(competition.status)}
    />
  );
}
