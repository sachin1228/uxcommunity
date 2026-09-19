/**
 * Competition domain types.
 *
 * These describe exactly what the API returns, so pages, client components and
 * the admin tools agree on one shape. The timestamps stay ISO strings on the
 * client (serialization boundary) and the derived `status` always travels with
 * the row so nothing has to re-derive it in a component.
 */

import type { CompetitionStatus } from "./cycle";

export interface CompetitionBrief {
  problem: string;
  challenge: string;
  deliverable: string;
  dimensions: string;
  judging: string;
}

export interface CompetitionVotingRules {
  /** One vote per member per entry (the MVP rule). */
  one_vote_per_entry: boolean;
  /** Designers may vote for their own entry. Off by default. */
  allow_self_vote: boolean;
  /** Members may withdraw a vote they cast. */
  allow_vote_removal: boolean;
  /** Show a vote-ordered leaderboard while voting is open. Off by default. */
  show_live_leaderboard: boolean;
}

export const DEFAULT_VOTING_RULES: CompetitionVotingRules = {
  one_vote_per_entry: true,
  allow_self_vote: false,
  allow_vote_removal: true,
  show_live_leaderboard: false,
};

export const DEFAULT_COMPETITION_RULES: string[] = [
  "One submission per person",
  "Design must be original",
  "No AI-generated final designs",
  "Follow the challenge brief",
  "Be respectful when voting and commenting",
  "Submission must be uploaded before the deadline",
];

export interface CompetitionRow {
  id: string;
  slug: string;
  week_number: number;
  title: string;
  description: string;
  brief: CompetitionBrief;
  rules: string[];
  category: string;
  difficulty: string;
  cover_image_url: string | null;
  start_at: string;
  submission_deadline: string;
  voting_deadline: string;
  results_at: string;
  archived_at: string | null;
  max_entries_per_user: number;
  voting_rules: CompetitionVotingRules;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A competition plus the status derived from its timestamps. */
export interface Competition extends CompetitionRow {
  status: CompetitionStatus;
}

export interface CompetitionStats {
  entries: number;
  designers: number;
  votes: number;
  comments: number;
  participants: number;
}

export interface CompetitionEntry {
  id: string;
  competition_id: string;
  user_id: string;
  title: string;
  description: string;
  cover_image_url: string;
  design_image_url: string;
  image_urls: CompetitionEntryImage[];
  figma_url: string | null;
  prototype_url: string | null;
  tools: string[];
  tags: string[];
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_avatar_url: string | null;
  /** The designer's job title — shown under their name. */
  author_role: string | null;
  vote_count: number;
  comment_count: number;
  user_voted: boolean;
  user_bookmarked: boolean;
}

export interface CompetitionEntryImage {
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface CompetitionComment {
  id: string;
  competition_id: string;
  entry_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_avatar_url: string | null;
  replies: CompetitionComment[];
}

export interface CompetitionWinner {
  competition_id: string;
  entry_id: string;
  user_id: string;
  title: string;
  cover_image_url: string;
  design_image_url: string;
  author_name: string;
  author_avatar_url: string | null;
  vote_count: number;
}

/**
 * One entry as the admin moderation list renders it — including soft-deleted
 * rows, because moderation has to see and reverse what it removed.
 */
export interface AdminEntryRow {
  id: string;
  title: string;
  author_name: string;
  author_avatar_url: string | null;
  cover_image_url: string;
  created_at: string;
  is_featured: boolean;
  soft_deleted_at: string | null;
  soft_deleted_reason: string | null;
  vote_count: number;
}

/** One cycle as the archive list renders it. */
export interface ArchivedCompetition {
  competition: Competition;
  stats: CompetitionStats;
  winner: CompetitionWinner | null;
}

/** Everything the landing page needs, in one payload. */
export interface CompetitionHomePayload {
  current: Competition | null;
  currentStats: CompetitionStats | null;
  currentEntries: CompetitionEntry[];
  /** The winner of the cycle currently in results/archive state. */
  currentWinner: CompetitionWinner | null;
  upcoming: Competition | null;
  nextAfterUpcoming: Competition | null;
  archive: ArchivedCompetition[];
}

/** Everything the challenge page needs. */
export interface CompetitionDetailPayload {
  competition: Competition;
  stats: CompetitionStats;
  entries: CompetitionEntry[];
  /** The viewer's own entry, when they have one (drives edit / "Entry submitted"). */
  myEntry: CompetitionEntry | null;
  /** Populated once voting has closed. */
  winner: CompetitionWinner | null;
  /** The cycle that opens next Sunday. */
  upcoming: Competition | null;
}
