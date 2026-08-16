import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getMyDuels } from "@/lib/design-duel/server-data";
import { sanitizeDesign } from "@/lib/design-duel/design";
import { DuelChallengePage } from "@/components/design-duel/DuelChallengePage";

export const metadata = { title: "Design Duel Challenge — uxcommunity" };

export const dynamic = "force-dynamic";

export default async function ChallengeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const userId = session?.userId ?? "";
  const challengeId = (await params).id;
  const db = createServiceClient();

  const [{ data: challenge }, { data: submission }] = await Promise.all([
    db.from("design_duel_challenges").select("*").eq("id", challengeId).maybeSingle(),
    userId
      ? db
          .from("design_duel_submissions")
          .select("id, status, started_at, design_json")
          .eq("challenge_id", challengeId)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!challenge) notFound();

  const myDuels = submission?.status === "submitted" ? await getMyDuels(db, userId) : [];
  const myDuel = myDuels.find((duel) => duel.challenge_id === challengeId) ?? null;

  return (
    <DuelChallengePage
      challenge={{
        ...challenge,
        starting_design:
          sanitizeDesign(challenge.starting_design) ?? { frame: { width: 375, height: 812 }, components: [] },
      }}
      submission={
        submission
          ? {
              id: submission.id,
              status: submission.status,
              started_at: submission.started_at,
              design_json: sanitizeDesign(submission.design_json),
            }
          : null
      }
      myDuel={myDuel}
    />
  );
}