// Design Duel — server-side data helpers. Server-only (imports the
// service client). Used by both API routes and server components.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import type {
  DuelChallenge,
  DuelLeaderboardEntry,
  DuelStats,
  DuelSubmission,
  DuelView,
} from "./types";
import { sanitizeDesign } from "./design";

type Db = SupabaseClient;

function parseDesign(json: unknown) {
  return sanitizeDesign(json);
}

export async function listChallenges(
  db: Db,
  userId: string | null,
): Promise<DuelChallenge[]> {
  const { data, error } = await db
    .from("design_duel_challenges")
    .select(
      "id, slug, title, description, goal, difficulty, time_limit_seconds, starting_design, constraints, status, min_votes, duel_duration_minutes, featured, created_at, expires_at, " +
        "submission_count:design_duel_submissions!design_duel_submissions_challenge_id_fkey(count), " +
        "duel_count:design_duels!design_duels_challenge_id_fkey(count)",
    )
    .eq("status", "active")
    .order("featured", { ascending: false })
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const challenges = data.map((row) => {
    const challenge: DuelChallenge = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      goal: row.goal ?? "",
      difficulty: row.difficulty,
      time_limit_seconds: row.time_limit_seconds,
      starting_design: sanitizeDesign(row.starting_design) ?? {
        frame: { width: 375, height: 812 },
        components: [],
      },
      constraints: Array.isArray(row.constraints)
        ? row.constraints.filter((item): item is string => typeof item === "string")
        : [],
      status: row.status,
      min_votes: row.min_votes,
      duel_duration_minutes: row.duel_duration_minutes,
      featured: row.featured,
      created_at: row.created_at,
      expires_at: row.expires_at,
      submission_count: Array.isArray(row.submission_count)
        ? (row.submission_count as { count: number }[])[0]?.count ?? 0
        : Number(row.submission_count) || 0,
      duel_count: Array.isArray(row.duel_count)
        ? (row.duel_count as { count: number }[])[0]?.count ?? 0
        : Number(row.duel_count) || 0,
    };
    return challenge;
  });

  if (userId) {
    const { data: mine } = await db
      .from("design_duel_submissions")
      .select("challenge_id, status")
      .eq("user_id", userId)
      .in("challenge_id", challenges.map((c) => c.id));
    const statusByChallenge = new Map<string, "in_progress" | "submitted">();
    for (const row of mine ?? []) {
      statusByChallenge.set(row.challenge_id, row.status);
    }
    for (const challenge of challenges) {
      challenge.my_status = statusByChallenge.get(challenge.id) ?? "none";
    }
  }

  return challenges;
}

export async function getMyStats(db: Db, userId: string): Promise<DuelStats | null> {
  const [{ data: rating }, { data: stats }] = await Promise.all([
    db.from("user_design_ratings").select("*").eq("user_id", userId).maybeSingle(),
    db.from("user_game_stats").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (!rating) return null;
  const duels = rating.duels_played ?? 0;
  const wins = rating.wins ?? 0;
  return {
    rating: rating.rating ?? 1500,
    xp: stats?.xp ?? 0,
    wins,
    losses: rating.losses ?? 0,
    draws: rating.draws ?? 0,
    duels_played: duels,
    win_streak: rating.win_streak ?? 0,
    best_streak: rating.best_streak ?? 0,
    win_rate: duels > 0 ? Math.round((wins / duels) * 100) : 0,
    challenges_completed: stats?.challenges_completed ?? 0,
    votes_cast: stats?.votes_cast ?? 0,
    rank: null,
    total_players: 0,
  };
}

export async function getLeaderboard(
  db: Db,
  userId: string,
  period: "weekly" | "all" = "weekly",
  limit = 100,
): Promise<{ entries: DuelLeaderboardEntry[]; myRank: number | null; total: number }> {
  const { data, error } = await callPerformanceRpc(db, "get_design_duel_leaderboard", {
    p_user_id: userId,
    p_period: period,
    p_limit: limit,
  });
  const rows = (data ?? []) as { item: unknown }[];
  const entries: DuelLeaderboardEntry[] = [];
  let myRank: number | null = null;
  let total = 0;
  for (const row of rows) {
    const item = row.item as DuelLeaderboardEntry;
    if (!item || typeof item !== "object") continue;
    total = item.total_players ?? total;
    entries.push(item);
    if (item.is_me) myRank = Number(item.rank);
  }
  return { entries, myRank, total };
}

async function loadDesignFor(db: Db, submissionId: string) {
  const { data } = await db
    .from("design_duel_submissions")
    .select("design_json, preview_image")
    .eq("id", submissionId)
    .maybeSingle();
  return {
    design_json: parseDesign(data?.design_json),
    preview_image: data?.preview_image ?? null,
  };
}

/** Anonymous list of open duels the user can vote on. */
export async function getOpenDuelsToVote(db: Db, userId: string): Promise<DuelView[]> {
  const { data: duels, error } = await db
    .from("design_duels")
    .select(
      "id, challenge_id, status, winner_submission_id, ends_at, created_at, resolved_at, submission_a_id, submission_b_id, " +
        "challenges!design_duels_challenge_id_fkey(title, min_votes)",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error || !duels) return [];

  const views: DuelView[] = [];
  for (const duel of duels) {
    const a = await loadDesignFor(db, duel.submission_a_id);
    const b = await loadDesignFor(db, duel.submission_b_id);
    const [{ data: aUser }, { data: bUser }] = await Promise.all([
      db.from("design_duel_submissions").select("user_id").eq("id", duel.submission_a_id).single(),
      db.from("design_duel_submissions").select("user_id").eq("id", duel.submission_b_id).single(),
    ]);
    const [{ data: votes }, { data: myVote }] = await Promise.all([
      db.from("design_duel_votes").select("selected_submission_id").eq("duel_id", duel.id),
      db.from("design_duel_votes")
        .select("selected_submission_id, reason")
        .eq("duel_id", duel.id)
        .eq("voter_id", userId)
        .maybeSingle(),
    ]);
    views.push({
      id: duel.id,
      challenge_id: duel.challenge_id,
      challenge_title: duel.challenges?.title ?? "Design Duel",
      status: "open",
      winner_submission_id: null,
      ends_at: duel.ends_at,
      created_at: duel.created_at,
      resolved_at: null,
      min_votes: duel.challenges?.min_votes ?? 5,
      my_vote: myVote?.selected_submission_id ?? null,
      my_vote_reason: myVote?.reason ?? null,
      vote_count: votes?.length ?? 0,
      a_votes: (votes ?? []).filter((v) => v.selected_submission_id === duel.submission_a_id).length,
      b_votes: (votes ?? []).filter((v) => v.selected_submission_id === duel.submission_b_id).length,
      revealed: Boolean(myVote),
      i_am_participant: aUser?.user_id === userId || bUser?.user_id === userId,
      design_a: {
        submission_id: duel.submission_a_id,
        design_json: a.design_json,
        preview_image: a.preview_image,
        name: null,
        avatar_url: null,
        rating: null,
        percent: null,
        is_winner: false,
      },
      design_b: {
        submission_id: duel.submission_b_id,
        design_json: b.design_json,
        preview_image: b.preview_image,
        name: null,
        avatar_url: null,
        rating: null,
        percent: null,
        is_winner: false,
      },
    });
  }
  return views;
}

/** Duels involving the current user's submissions. */
export async function getMyDuels(db: Db, userId: string): Promise<DuelView[]> {
  const { data: subs } = await db
    .from("design_duel_submissions")
    .select("id, challenge_id")
    .eq("user_id", userId)
    .eq("status", "submitted");

  if (!subs || subs.length === 0) return [];

  const subIds = subs.map((s) => s.id);
  const { data: duels } = await db
    .from("design_duels")
    .select(
      "id, challenge_id, status, winner_submission_id, ends_at, created_at, resolved_at, submission_a_id, submission_b_id, " +
        "challenges!design_duels_challenge_id_fkey(title, min_votes)",
    )
    .or(
      `submission_a_id.in.(${subIds.join(",")}),submission_b_id.in.(${subIds.join(",")})`,
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (!duels || duels.length === 0) return [];

  const views: DuelView[] = [];
  for (const duel of duels) {
    const a = await loadDesignFor(db, duel.submission_a_id);
    const b = await loadDesignFor(db, duel.submission_b_id);
    const [{ data: aUser }, { data: bUser }] = await Promise.all([
      db.from("design_duel_submissions").select("user_id").eq("id", duel.submission_a_id).single(),
      db.from("design_duel_submissions").select("user_id").eq("id", duel.submission_b_id).single(),
    ]);
    const [aProfile, bProfile] = await Promise.all([
      aUser
        ? db.from("designer_profiles").select("avatar_url").eq("user_id", aUser.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      bUser
        ? db.from("designer_profiles").select("avatar_url").eq("user_id", bUser.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const [{ data: votes }, { data: myVote }] = await Promise.all([
      db.from("design_duel_votes").select("selected_submission_id").eq("duel_id", duel.id),
      db.from("design_duel_votes")
        .select("selected_submission_id, reason")
        .eq("duel_id", duel.id)
        .eq("voter_id", userId)
        .maybeSingle(),
    ]);
    const total = votes?.length ?? 0;
    const aVotes = (votes ?? []).filter((v) => v.selected_submission_id === duel.submission_a_id).length;
    const bVotes = (votes ?? []).filter((v) => v.selected_submission_id === duel.submission_b_id).length;
    const isA = aUser?.user_id === userId;
    const iAmA = isA;
    const myPercent = total > 0 ? (iAmA ? aVotes : bVotes) / total : 0;

    views.push({
      id: duel.id,
      challenge_id: duel.challenge_id,
      challenge_title: duel.challenges?.title ?? "Design Duel",
      status: duel.status,
      winner_submission_id: duel.winner_submission_id,
      ends_at: duel.ends_at,
      created_at: duel.created_at,
      resolved_at: duel.resolved_at,
      min_votes: duel.challenges?.min_votes ?? 5,
      my_vote: myVote?.selected_submission_id ?? null,
      my_vote_reason: myVote?.reason ?? null,
      vote_count: total,
      a_votes: aVotes,
      b_votes: bVotes,
      revealed: duel.status === "resolved",
      i_am_participant: true,
      design_a: {
        submission_id: duel.submission_a_id,
        design_json: a.design_json,
        preview_image: a.preview_image,
        name: aUser?.user_id === userId ? "You" : "Opponent",
        avatar_url: null,
        rating: null,
        percent: total > 0 ? Math.round((aVotes / total) * 100) : null,
        is_winner: duel.winner_submission_id === duel.submission_a_id,
      },
      design_b: {
        submission_id: duel.submission_b_id,
        design_json: b.design_json,
        preview_image: b.preview_image,
        name: bUser?.user_id === userId ? "You" : "Opponent",
        avatar_url: null,
        rating: null,
        percent: total > 0 ? Math.round((bVotes / total) * 100) : null,
        is_winner: duel.winner_submission_id === duel.submission_b_id,
      },
    });
  }
  return views;
}

/** Full duel view for the duel page (server component). */
export async function getDuelView(
  db: Db,
  duelId: string,
  userId: string,
): Promise<DuelView | null> {
  const { data: duel } = await db
    .from("design_duels")
    .select(
      "id, challenge_id, status, winner_submission_id, ends_at, created_at, resolved_at, submission_a_id, submission_b_id, " +
        "challenges!design_duels_challenge_id_fkey(title, min_votes)",
    )
    .eq("id", duelId)
    .maybeSingle();

  if (!duel) return null;

  const a = await loadDesignFor(db, duel.submission_a_id);
  const b = await loadDesignFor(db, duel.submission_b_id);

  const [{ data: aUser }, { data: bUser }] = await Promise.all([
    db.from("design_duel_submissions").select("user_id").eq("id", duel.submission_a_id).single(),
    db.from("design_duel_submissions").select("user_id").eq("id", duel.submission_b_id).single(),
  ]);

  const [{ data: myVote }, { data: votes }] = await Promise.all([
    db.from("design_duel_votes")
      .select("selected_submission_id, reason")
      .eq("duel_id", duelId)
      .eq("voter_id", userId)
      .maybeSingle(),
    db.from("design_duel_votes").select("selected_submission_id").eq("duel_id", duelId),
  ]);

  const total = votes?.length ?? 0;
  const aVotes = (votes ?? []).filter((v) => v.selected_submission_id === duel.submission_a_id).length;
  const bVotes = (votes ?? []).filter((v) => v.selected_submission_id === duel.submission_b_id).length;
  const revealed = duel.status === "resolved" || Boolean(myVote);

  const participants = [aUser?.user_id, bUser?.user_id].filter(Boolean);
  const iAmParticipant = participants.includes(userId);

  const [aName, bName, aRating, bRating] = revealed
    ? await Promise.all([
        db.from("users").select("name").eq("id", aUser?.user_id ?? "").maybeSingle(),
        db.from("users").select("name").eq("id", bUser?.user_id ?? "").maybeSingle(),
        db.from("user_design_ratings").select("rating").eq("user_id", aUser?.user_id ?? "").maybeSingle(),
        db.from("user_design_ratings").select("rating").eq("user_id", bUser?.user_id ?? "").maybeSingle(),
      ])
    : [null, null, null, null];

  return {
    id: duel.id,
    challenge_id: duel.challenge_id,
    challenge_title: duel.challenges?.title ?? "Design Duel",
    status: duel.status,
    winner_submission_id: duel.winner_submission_id,
    ends_at: duel.ends_at,
    created_at: duel.created_at,
    resolved_at: duel.resolved_at,
    min_votes: duel.challenges?.min_votes ?? 5,
    my_vote: myVote?.selected_submission_id ?? null,
    my_vote_reason: myVote?.reason ?? null,
    vote_count: total,
    a_votes: aVotes,
    b_votes: bVotes,
    revealed,
    i_am_participant: iAmParticipant,
    design_a: {
      submission_id: duel.submission_a_id,
      design_json: a.design_json,
      preview_image: a.preview_image,
      name: revealed ? (aName?.name ?? "Designer A") : null,
      avatar_url: null,
      rating: revealed ? aRating?.rating ?? null : null,
      percent: total > 0 ? Math.round((aVotes / total) * 100) : null,
      is_winner: duel.winner_submission_id === duel.submission_a_id,
    },
    design_b: {
      submission_id: duel.submission_b_id,
      design_json: b.design_json,
      preview_image: b.preview_image,
      name: revealed ? (bName?.name ?? "Designer B") : null,
      avatar_url: null,
      rating: revealed ? bRating?.rating ?? null : null,
      percent: total > 0 ? Math.round((bVotes / total) * 100) : null,
      is_winner: duel.winner_submission_id === duel.submission_b_id,
    },
  };
}

export { createServiceClient };

export async function ensureMySubmission(
  db: Db,
  challengeId: string,
  userId: string,
): Promise<DuelSubmission | null> {
  const { data: existing } = await db
    .from("design_duel_submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    return {
      ...existing,
      design_json: parseDesign(existing.design_json),
    } as DuelSubmission;
  }
  const { data: inserted, error } = await db
    .from("design_duel_submissions")
    .insert({ challenge_id: challengeId, user_id: userId, status: "in_progress", design_json: "{}" })
    .select("*")
    .single();
  if (error || !inserted) return null;
  return { ...inserted, design_json: null } as DuelSubmission;
}