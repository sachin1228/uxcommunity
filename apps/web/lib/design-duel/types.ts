// Design Duel — shared types for the competitive UI/UX game.

export type DuelComponentType = "text" | "button" | "card" | "image" | "input";
export type DuelAlign = "left" | "center" | "right";
export type DuelDifficulty = "easy" | "medium" | "hard";

export interface DuelComponent {
  id: string;
  type: DuelComponentType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  background: string | null;
  radius: number;
  padding: number;
  align: DuelAlign;
  opacity: number;
  imageUrl?: string | null;
}

export interface DuelDesign {
  frame: { width: number; height: number };
  components: DuelComponent[];
}

export interface DuelChallenge {
  id: string;
  slug: string;
  title: string;
  description: string;
  goal: string;
  difficulty: DuelDifficulty;
  time_limit_seconds: number;
  starting_design: DuelDesign;
  constraints: string[];
  status: string;
  min_votes: number;
  duel_duration_minutes: number;
  featured: boolean;
  created_at: string;
  expires_at: string | null;
  // server-computed
  submission_count?: number;
  duel_count?: number;
  my_status?: "none" | "in_progress" | "submitted";
}

export interface DuelSubmission {
  id: string;
  challenge_id: string;
  user_id: string;
  status: "in_progress" | "submitted";
  design_json: DuelDesign | null;
  preview_image: string | null;
  started_at: string;
  submitted_at: string | null;
  completion_time: number | null;
  is_late: boolean;
  created_at: string;
}

export interface DuelPlayerView {
  submission_id: string;
  design_json: DuelDesign | null;
  preview_image: string | null;
  name: string | null;
  avatar_url: string | null;
  rating: number | null;
  percent: number | null;
  is_winner: boolean;
}

export interface DuelView {
  id: string;
  challenge_id: string;
  challenge_title: string;
  status: "open" | "resolved";
  winner_submission_id: string | null;
  ends_at: string;
  created_at: string;
  resolved_at: string | null;
  min_votes: number;
  my_vote: string | null;
  my_vote_reason: string | null;
  vote_count: number;
  a_votes: number;
  b_votes: number;
  revealed: boolean;
  i_am_participant: boolean;
  design_a: DuelPlayerView;
  design_b: DuelPlayerView;
}

export interface DuelLeaderboardEntry {
  rank: number;
  user_id: string;
  name: string;
  avatar_url: string | null;
  rating: number;
  wins: number;
  duels_played: number;
  win_streak: number;
  xp: number;
  is_me: boolean;
  my_rank_offset?: boolean;
  total_players?: number;
}

export interface DuelStats {
  rating: number;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
  duels_played: number;
  win_streak: number;
  best_streak: number;
  win_rate: number;
  challenges_completed: number;
  votes_cast: number;
  rank: number | null;
  total_players: number;
}

export const VOTE_REASONS = [
  { value: "hierarchy", label: "Better hierarchy" },
  { value: "clarity", label: "Easier to understand" },
  { value: "visual", label: "Better visual design" },
  { value: "accessibility", label: "Better accessibility" },
  { value: "interaction", label: "Better interaction" },
] as const;