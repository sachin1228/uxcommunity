import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getMyStats,
  listChallenges,
  getOpenDuelsToVote,
  getMyDuels,
  getLeaderboard,
} from "@/lib/design-duel/server-data";
import { DesignDuelHome } from "@/components/design-duel/DesignDuelHome";

export const metadata = { title: "Design Duel — uxcommunity" };

export const dynamic = "force-dynamic";

export default async function DesignDuelPage() {
  const session = await getSession();
  const userId = session?.userId ?? "";
  const db = createServiceClient();

  const [challenges, stats, openDuels, myDuels, leaderboard] = await Promise.all([
    listChallenges(db, userId),
    userId ? getMyStats(db, userId) : Promise.resolve(null),
    userId ? getOpenDuelsToVote(db, userId) : Promise.resolve([]),
    userId ? getMyDuels(db, userId) : Promise.resolve([]),
    userId
      ? getLeaderboard(db, userId, "weekly", 10)
      : Promise.resolve({ entries: [], myRank: null, total: 0 }),
  ]);

  if (stats) {
    stats.rank = leaderboard.myRank;
    stats.total_players = leaderboard.total;
  }

  return (
    <DesignDuelHome
      challenges={challenges}
      stats={stats}
      openDuels={openDuels}
      myDuels={myDuels}
      leaderboard={leaderboard}
      userId={userId}
    />
  );
}