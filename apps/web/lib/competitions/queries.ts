import "server-only";

/**
 * Server-side data access for competitions.
 *
 * Every read goes through the service-role client (the app's custom cookie
 * auth has no Supabase Auth session), so these helpers are the only place that
 * knows how a competition row becomes a `Competition` with a derived status.
 * Pages and API routes share them so the derived status can never disagree
 * between the two.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { canRankByVotes, deriveCompetitionStatus, resolveEntrySort } from "./cycle";

// The gallery sort rule is pure cycle logic, so it lives in cycle.ts (and is
// unit-tested there); re-exported here for the server-side callers.
export { resolveEntrySort };
import {
  DEFAULT_COMPETITION_RULES,
  DEFAULT_VOTING_RULES,
  type AdminEntryRow,
  type ArchivedCompetition,
  type Competition,
  type CompetitionComment,
  type CompetitionDetailPayload,
  type CompetitionEntry,
  type CompetitionEntryImage,
  type CompetitionHomePayload,
  type CompetitionRow,
  type CompetitionStats,
  type CompetitionWinner,
} from "./types";

type Db = ReturnType<typeof createServiceClient>;

const EMPTY_STATS: CompetitionStats = { entries: 0, designers: 0, votes: 0, comments: 0, participants: 0 };

/** Fallback used when a competition predates a column or the row is partial. */
function normalizeRow(row: Record<string, unknown>): CompetitionRow {
  return {
    id: String(row.id),
    slug: String(row.slug),
    week_number: Number(row.week_number ?? 0),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    brief: (row.brief ?? {}) as CompetitionRow["brief"],
    rules: Array.isArray(row.rules) ? (row.rules as string[]) : DEFAULT_COMPETITION_RULES,
    category: String(row.category ?? "Product Design"),
    difficulty: String(row.difficulty ?? "intermediate"),
    cover_image_url: (row.cover_image_url as string | null) ?? null,
    start_at: String(row.start_at),
    submission_deadline: String(row.submission_deadline),
    voting_deadline: String(row.voting_deadline),
    results_at: String(row.results_at),
    archived_at: (row.archived_at as string | null) ?? null,
    max_entries_per_user: Number(row.max_entries_per_user ?? 1),
    voting_rules: {
      ...DEFAULT_VOTING_RULES,
      ...((row.voting_rules ?? {}) as Record<string, boolean>),
    },
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

export function withStatus(row: CompetitionRow, now: Date = new Date()): Competition {
  return {
    ...row,
    status: deriveCompetitionStatus(row, now, row.archived_at),
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toImages(value: unknown): CompetitionEntryImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "Design image",
      url: String(item.url ?? ""),
      type: typeof item.type === "string" ? item.type : "image/jpeg",
      size: typeof item.size === "number" ? item.size : 0,
    }))
    .filter((image) => image.url.startsWith("https://"));
}

function toEntry(row: Record<string, unknown>): CompetitionEntry {
  return {
    id: String(row.id),
    competition_id: String(row.competition_id),
    user_id: String(row.user_id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    cover_image_url: String(row.cover_image_url ?? ""),
    design_image_url: String(row.design_image_url ?? row.cover_image_url ?? ""),
    image_urls: toImages(row.image_urls),
    figma_url: (row.figma_url as string | null) ?? null,
    prototype_url: (row.prototype_url as string | null) ?? null,
    tools: toStringArray(row.tools),
    tags: toStringArray(row.tags),
    is_featured: row.is_featured === true,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
    author_name: String(row.author_name ?? "Community member"),
    author_avatar_url: (row.author_avatar_url as string | null) ?? null,
    author_role: (row.author_role as string | null) ?? null,
    vote_count: Number(row.vote_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    user_voted: row.user_voted === true,
    user_bookmarked: row.user_bookmarked === true,
  };
}

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------

const COMPETITION_COLUMNS =
  "id, slug, week_number, title, description, brief, rules, category, difficulty, cover_image_url, start_at, submission_deadline, voting_deadline, results_at, archived_at, max_entries_per_user, voting_rules, created_by, created_at, updated_at";

/**
 * Every cycle, newest first. Weekly competitions cap this naturally (52/year),
 * and the partial ordering by week_number keeps the scan bounded.
 */
export async function listCompetitions(db: Db, limit = 200): Promise<Competition[]> {
  const { data, error } = await db
    .from("competitions")
    .select(COMPETITION_COLUMNS)
    .order("week_number", { ascending: false })
    .limit(limit);

  if (error) throw error;
  const now = new Date();
  return (data ?? []).map((row) => withStatus(normalizeRow(row as Record<string, unknown>), now));
}

export async function getCompetitionBySlug(db: Db, slug: string): Promise<Competition | null> {
  const { data, error } = await db
    .from("competitions")
    .select(COMPETITION_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return withStatus(normalizeRow(data as Record<string, unknown>));
}

export async function getCompetitionById(db: Db, id: string): Promise<Competition | null> {
  const { data, error } = await db
    .from("competitions")
    .select(COMPETITION_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return withStatus(normalizeRow(data as Record<string, unknown>));
}

/**
 * The competition a viewer should treat as "the current one":
 * the live cycle if one is running, otherwise the one whose results are being
 * celebrated, otherwise nothing (the landing page then leads with "upcoming").
 */
export function pickCurrent(competitions: Competition[]): Competition | null {
  const grouped: Record<CompetitionStatus, Competition[]> = {
    live: [],
    voting_closed: [],
    results: [],
    upcoming: [],
    archived: [],
  };
  for (const competition of competitions) grouped[competition.status].push(competition);

  const byWeekDesc = (a: Competition, b: Competition) => b.week_number - a.week_number;
  return (
    grouped.live.sort(byWeekDesc)[0] ??
    grouped.voting_closed.sort(byWeekDesc)[0] ??
    grouped.results.sort(byWeekDesc)[0] ??
    grouped.upcoming.sort(byWeekDesc)[0] ??
    null
  );
}

export function pickUpcoming(competitions: Competition[]): Competition | null {
  const upcoming = competitions
    .filter((competition) => competition.status === "upcoming")
    .sort((a, b) => a.week_number - b.week_number);
  return upcoming[0] ?? null;
}

export function pickArchived(competitions: Competition[]): Competition[] {
  return competitions
    .filter((competition) => competition.status === "archived")
    .sort((a, b) => b.week_number - a.week_number);
}

// ---------------------------------------------------------------------------
// Entries, votes, stats
// ---------------------------------------------------------------------------

export async function getEntries(
  db: Db,
  competitionId: string,
  userId: string,
  options: { sort?: string; limit?: number; offset?: number } = {},
): Promise<CompetitionEntry[]> {
  const { data, error } = await callPerformanceRpc(db, "get_competition_entries", {
    p_competition_id: competitionId,
    p_user_id: userId,
    p_sort: options.sort ?? "recent",
    p_limit: options.limit ?? 60,
    p_offset: options.offset ?? 0,
  });

  if (error) throw error;
  return (data ?? []).map((row) => toEntry(row as unknown as Record<string, unknown>));
}

export async function getEntry(
  db: Db,
  competitionId: string,
  entryId: string,
  userId: string,
): Promise<CompetitionEntry | null> {
  const { data, error } = await callPerformanceRpc(db, "get_competition_entry", {
    p_competition_id: competitionId,
    p_entry_id: entryId,
    p_user_id: userId,
  });

  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? toEntry(row as unknown as Record<string, unknown>) : null;
}

/** The viewer's own submission(s) in a cycle. */
export async function getMyEntries(
  db: Db,
  competitionId: string,
  userId: string,
): Promise<CompetitionEntry[]> {
  const { data, error } = await db
    .from("competition_entries")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("user_id", userId)
    .is("soft_deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const ids = (data ?? []).map((row) => (row as { id: string }).id);
  if (!ids.length) return [];

  const entries = await Promise.all(ids.map((id) => getEntry(db, competitionId, id, userId)));
  return entries.filter((entry): entry is CompetitionEntry => Boolean(entry));
}

export async function getStats(db: Db, competitionId: string): Promise<CompetitionStats> {
  const { data, error } = await callPerformanceRpc(db, "get_competition_stats", {
    p_competition_id: competitionId,
  });
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? { ...EMPTY_STATS, ...row } : { ...EMPTY_STATS };
}

export async function getStatsBulk(
  db: Db,
  competitionIds: string[],
): Promise<Map<string, CompetitionStats>> {
  const map = new Map<string, CompetitionStats>();
  if (!competitionIds.length) return map;

  const { data, error } = await callPerformanceRpc(db, "get_competition_stats_bulk", {
    p_competition_ids: competitionIds,
  });
  if (error) throw error;

  for (const row of data ?? []) {
    map.set(row.competition_id, {
      entries: row.entries ?? 0,
      designers: row.designers ?? 0,
      votes: row.votes ?? 0,
      comments: row.comments ?? 0,
      participants: row.participants ?? 0,
    });
  }
  return map;
}

export async function getWinners(
  db: Db,
  competitionIds: string[],
): Promise<Map<string, CompetitionWinner>> {
  const map = new Map<string, CompetitionWinner>();
  if (!competitionIds.length) return map;

  const { data, error } = await callPerformanceRpc(db, "get_competition_winners", {
    p_competition_ids: competitionIds,
  });
  if (error) throw error;

  for (const row of data ?? []) {
    map.set(row.competition_id, {
      competition_id: row.competition_id,
      entry_id: row.entry_id,
      user_id: row.user_id,
      title: row.title,
      cover_image_url: row.cover_image_url,
      design_image_url: row.design_image_url,
      author_name: row.author_name,
      author_avatar_url: row.author_avatar_url,
      vote_count: row.vote_count ?? 0,
    });
  }
  return map;
}

export async function getComments(db: Db, entryId: string): Promise<CompetitionComment[]> {
  const { data, error } = await db
    .from("competition_comments")
    .select("id, competition_id, entry_id, user_id, parent_id, body, created_at, updated_at")
    .eq("entry_id", entryId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return [];

  const authorIds = [...new Set(rows.map((row) => String(row.user_id)))];
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", authorIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", authorIds),
  ]);
  const names = new Map((users ?? []).map((user) => [user.id, user.name]));
  const avatars = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_url]));

  const comments: CompetitionComment[] = rows.map((row) => ({
    id: String(row.id),
    competition_id: String(row.competition_id),
    entry_id: String(row.entry_id),
    user_id: String(row.user_id),
    parent_id: (row.parent_id as string | null) ?? null,
    body: String(row.body ?? ""),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
    author_name: names.get(String(row.user_id)) ?? "Community member",
    author_avatar_url: avatars.get(String(row.user_id)) ?? null,
    replies: [],
  }));

  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const top: CompetitionComment[] = [];
  for (const comment of comments) {
    if (comment.parent_id && byId.has(comment.parent_id)) {
      byId.get(comment.parent_id)!.replies.push(comment);
    } else {
      top.push(comment);
    }
  }
  return top;
}

// ---------------------------------------------------------------------------
// Page payloads
// ---------------------------------------------------------------------------

/** Landing page: current challenge, next challenge, and the archive preview. */
export async function loadCompetitionHome(
  db: Db,
  userId: string,
  archiveLimit = 6,
): Promise<CompetitionHomePayload> {
  const competitions = await listCompetitions(db);
  const current = pickCurrent(competitions);
  const upcoming = pickUpcoming(competitions);
  const nextAfterUpcoming =
    upcoming
      ? competitions
          .filter(
            (competition) =>
              competition.week_number > upcoming.week_number &&
              competition.status === "upcoming",
          )
          .sort((a, b) => a.week_number - b.week_number)[0] ?? null
      : null;

  const [currentStats, currentEntries, currentWinnerMap, archivedRows] = await Promise.all([
    current ? getStats(db, current.id) : Promise.resolve(null),
    current
      ? getEntries(db, current.id, userId, {
          sort: resolveEntrySort(null, current.status),
          limit: 6,
        })
      : Promise.resolve([]),
    current && current.status !== "live" && current.status !== "voting_closed"
      ? getWinners(db, [current.id])
      : Promise.resolve(new Map<string, CompetitionWinner>()),
    Promise.resolve(pickArchived(competitions).slice(0, archiveLimit)),
  ]);

  const archivedIds = archivedRows.map((competition) => competition.id);
  const [archiveStats, archiveWinners] = await Promise.all([
    getStatsBulk(db, archivedIds),
    getWinners(db, archivedIds),
  ]);

  const archive: ArchivedCompetition[] = archivedRows.map((competition) => ({
    competition,
    stats: archiveStats.get(competition.id) ?? { ...EMPTY_STATS },
    winner: archiveWinners.get(competition.id) ?? null,
  }));

  return {
    current,
    currentStats,
    currentEntries,
    currentWinner: current ? currentWinnerMap.get(current.id) ?? null : null,
    upcoming,
    nextAfterUpcoming,
    archive,
  };
}

/** Challenge page: brief, gallery, the viewer's entry, and results when closed. */
export async function loadCompetitionDetail(
  db: Db,
  slug: string,
  userId: string,
  options: { sort?: string | null; limit?: number } = {},
): Promise<CompetitionDetailPayload | null> {
  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) return null;

  const competitions = await listCompetitions(db);
  const upcoming = pickUpcoming(competitions);

  const [stats, entries, myEntries, winners] = await Promise.all([
    getStats(db, competition.id),
    getEntries(db, competition.id, userId, {
      sort: resolveEntrySort(options.sort ?? null, competition.status),
      limit: options.limit ?? 60,
    }),
    getMyEntries(db, competition.id, userId),
    canRankByVotes(competition.status)
      ? getWinners(db, [competition.id])
      : Promise.resolve(new Map<string, CompetitionWinner>()),
  ]);

  return {
    competition,
    stats,
    entries,
    myEntry: myEntries[0] ?? null,
    winner:
      competition.status === "results" || competition.status === "archived"
        ? winners.get(competition.id) ?? null
        : null,
    upcoming: upcoming && upcoming.id !== competition.id ? upcoming : null,
  };
}

/** Full archive page: every finished cycle, newest first. */
export async function loadCompetitionArchive(db: Db): Promise<ArchivedCompetition[]> {
  const competitions = await listCompetitions(db);
  const archived = pickArchived(competitions);
  const ids = archived.map((competition) => competition.id);
  const [stats, winners] = await Promise.all([getStatsBulk(db, ids), getWinners(db, ids)]);

  return archived.map((competition) => ({
    competition,
    stats: stats.get(competition.id) ?? { ...EMPTY_STATS },
    winner: winners.get(competition.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Writes shared by the API routes
// ---------------------------------------------------------------------------

/**
 * Participants are recorded on first meaningful action (submit, vote, or
 * comment) and never downgraded, so `first_action` stays the story of how
 * someone joined the week. Conflict-free upsert: repeated actions are no-ops.
 */
export async function recordParticipant(
  db: Db,
  competitionId: string,
  userId: string,
  action: "entry" | "vote" | "comment",
): Promise<void> {
  const { error } = await db
    .from("competition_participants")
    .upsert(
      { competition_id: competitionId, user_id: userId, first_action: action },
      { onConflict: "competition_id,user_id", ignoreDuplicates: true },
    );
  if (error) console.error("[competitions] participant upsert failed", error);
}

/**
 * Append-only audit trail for the actions that decide a winner. Best effort:
 * a failed audit write must never fail the user's action.
 */
export async function recordAudit(
  db: Db,
  input: {
    competitionId: string | null;
    actorId: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db.from("competition_audit_log").insert({
    competition_id: input.competitionId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) console.error("[competitions] audit insert failed", error);
}

/**
 * Every entry in a cycle for the admin view — including soft-deleted ones,
 * because moderation has to be able to see and reverse what it removed.
 */
export async function getAdminEntries(db: Db, competitionId: string): Promise<AdminEntryRow[]> {
  const { data, error } = await db
    .from("competition_entries")
    .select(
      "id, user_id, title, cover_image_url, created_at, is_featured, soft_deleted_at, soft_deleted_reason",
    )
    .eq("competition_id", competitionId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return [];

  const entryIds = rows.map((row) => String(row.id));
  const authorIds = [...new Set(rows.map((row) => String(row.user_id)))];

  const [{ data: users }, { data: profiles }, { data: votes }] = await Promise.all([
    db.from("users").select("id, name").in("id", authorIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", authorIds),
    db.from("competition_votes").select("entry_id").in("entry_id", entryIds),
  ]);

  const names = new Map((users ?? []).map((user) => [user.id, user.name]));
  const avatars = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_url]));
  const voteCounts = new Map<string, number>();
  for (const vote of votes ?? []) {
    const entryId = String(vote.entry_id);
    voteCounts.set(entryId, (voteCounts.get(entryId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    author_name: names.get(String(row.user_id)) ?? "Community member",
    author_avatar_url: avatars.get(String(row.user_id)) ?? null,
    cover_image_url: String(row.cover_image_url ?? ""),
    created_at: String(row.created_at),
    is_featured: row.is_featured === true,
    soft_deleted_at: (row.soft_deleted_at as string | null) ?? null,
    soft_deleted_reason: (row.soft_deleted_reason as string | null) ?? null,
    vote_count: voteCounts.get(String(row.id)) ?? 0,
  }));
}

/** Soft-delete keeps a suspicious entry in history while removing it from the gallery. */
export async function softDeleteEntry(
  db: Db,
  input: { entryId: string; actorId: string; reason: string },
): Promise<boolean> {
  const { error } = await db
    .from("competition_entries")
    .update({
      soft_deleted_at: new Date().toISOString(),
      soft_deleted_by: input.actorId,
      soft_deleted_reason: input.reason,
    })
    .eq("id", input.entryId)
    .is("soft_deleted_at", null);

  if (error) {
    console.error("[competitions] soft delete failed", error);
    return false;
  }
  return true;
}
